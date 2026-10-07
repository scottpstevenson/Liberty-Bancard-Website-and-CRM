import pg from "pg";
import {randomUUID} from "node:crypto";
import {monitorEventLoopDelay,performance} from "node:perf_hooks";
import {fingerprintQuery, readLockTrace, safeDatabaseFailure,lockTraceProcessInstanceId} from "../lib/lock-trace";

/** Only live connection/lock metadata; never business tables or provider I/O.
 * UNION deduplicates the recursive PID walk, including cycles. */
export const PRIMARY_LOCK_SNAPSHOT_SQL = `
WITH RECURSIVE activity AS MATERIALIZED (
  SELECT pid,state,wait_event_type,wait_event,query,
    pg_blocking_pids(pid) AS blockers,
    EXTRACT(EPOCH FROM clock_timestamp()-xact_start)*1000 AS transaction_age_ms,
    EXTRACT(EPOCH FROM clock_timestamp()-query_start)*1000 AS query_age_ms
  FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
), roots AS (
  SELECT pid FROM activity WHERE cardinality(blockers)>0
  ORDER BY CASE WHEN query LIKE '%canonical%' OR query LIKE '%sfp_runtime_%' THEN 0 ELSE 1 END,pid
  LIMIT 16
), chain(pid) AS (
  SELECT pid FROM roots
  UNION
  SELECT unnest(a.blockers) FROM chain c JOIN activity a ON a.pid=c.pid
)
SELECT a.pid,a.state,a.wait_event_type,a.wait_event,a.query,
  a.blockers,a.transaction_age_ms,a.query_age_ms,
  (SELECT COALESCE(jsonb_agg(l),'[]'::jsonb) FROM (
    SELECT locktype,mode,granted,relation::text AS relation_oid,
      transactionid::text AS transaction_id,classid::text,objid::text,objsubid
    FROM pg_locks WHERE pid=a.pid
    ORDER BY granted,locktype,relation LIMIT 16
  ) l) AS locks
FROM activity a JOIN chain c ON c.pid=a.pid ORDER BY a.pid LIMIT 64`;

type DiagnosticClient = {
  connect(): Promise<unknown>;
  query(text: string): Promise<{rows: any[]}>;
  end(): Promise<unknown>;
  on(event: "error", callback: (error: unknown) => void): unknown;
};
type CaptureState = "idle" | "connecting" | "capturing" | "completed" | "failed" | "refused_replica";
const asNumber = (value: unknown) => value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;

export function sanitizeLockSnapshot(rows: any[]) {
  return rows.slice(0,64).map(row => ({
    backendPid: asNumber(row.pid),
    trace: readLockTrace(typeof row.query === "string" ? row.query : ""),
    queryHash: typeof row.query === "string" ? fingerprintQuery(row.query) : null,
    state: ["active","idle","idle in transaction","idle in transaction (aborted)"].includes(row.state) ? row.state : null,
    waitEventType: typeof row.wait_event_type === "string" && /^[A-Za-z]+$/.test(row.wait_event_type) ? row.wait_event_type : null,
    waitEvent: typeof row.wait_event === "string" && /^[A-Za-z0-9_]+$/.test(row.wait_event) ? row.wait_event : null,
    blockingPids: Array.isArray(row.blockers) ? row.blockers.slice(0,64).map(asNumber) : [],
    transactionAgeMs: asNumber(row.transaction_age_ms),
    queryAgeMs: asNumber(row.query_age_ms),
    locks: (Array.isArray(row.locks) ? row.locks : []).slice(0,16).map((lock: any) => ({
      type: typeof lock.locktype === "string" && /^[a-z_]+$/.test(lock.locktype) ? lock.locktype : null,
      mode: typeof lock.mode === "string" && /^[A-Za-z]+$/.test(lock.mode) ? lock.mode : null,
      granted: lock.granted === true,
      relationOid: asNumber(lock.relation_oid), transactionId: asNumber(lock.transaction_id),
      classId: asNumber(lock.classid), objectId: asNumber(lock.objid), objectSubId: asNumber(lock.objsubid),
    })),
  }));
}

/** One independent READ-ONLY connection, never a pool slot or authority lock.
 * Limits belong ONLY to observation; application timeouts/leases are unchanged. */
export class PrimaryLockCapture {
  private state: CaptureState = "idle";
  private captureId: string | null = null;
  private samples = 0;
  private blockedSamples = 0;
  private recent: Record<string, unknown>[] = [];
  private failure: ReturnType<typeof safeDatabaseFailure> | null = null;
  private startedAt: string | null = null;
  private finishedAt: string | null = null;
  private running: Promise<void> = Promise.resolve();
  private runtimeDiagnostics=false;
  private runtime: Record<string,number>|null=null;
  constructor(private options: {
    createClient?: () => DiagnosticClient;
    emit?: (event: Record<string, unknown>) => void;
    durationMs?: number;
    intervalMs?: number;
  } = {}) {
    if ((options.durationMs ?? 60_000) < 1 || (options.durationMs ?? 60_000) > 60_000
      || (options.intervalMs ?? 250) < 10 || (options.intervalMs ?? 250) > 1000)
      throw new Error("PRIMARY_LOCK_CAPTURE_INVALID_BOUNDS");
  }
  status() {
    // No caller can mutate retained evidence.
    return structuredClone({state:this.state,captureId:this.captureId,startedAt:this.startedAt,
      finishedAt:this.finishedAt,samples:this.samples,blockedSamples:this.blockedSamples,
      failure:this.failure,recent:this.recent,runtime:this.runtime,
      runtimeProcessInstanceId:this.runtimeDiagnostics ? lockTraceProcessInstanceId() : null});
  }
  start(options:{runtimeDiagnostics?:boolean}={}) {
    if (this.state === "connecting" || this.state === "capturing") return this.status();
    this.captureId=randomUUID(); this.samples=0; this.blockedSamples=0; this.recent=[];
    this.failure=null; this.startedAt=new Date().toISOString(); this.finishedAt=null;
    this.runtimeDiagnostics=options.runtimeDiagnostics===true;this.runtime=null;
    this.state="connecting"; this.running=this.run();
    return this.status();
  }
  finished() { return this.running; }
  private report(event: Record<string, unknown>) {
    try { (this.options.emit ?? (value => console.warn(JSON.stringify(value))))({
      ...event,captureId:this.captureId,ts:new Date().toISOString(),
    }); } catch { /* Never affect application behavior. */ }
  }
  private async run() {
    let client: DiagnosticClient | undefined;
    let hardStop: ReturnType<typeof setTimeout> | undefined;
    let ended=false;
    const close=async()=>{
      if (ended || !client) return;
      ended=true;
      try { await client.end(); } catch { /* Preserve original observation error. */ }
    };
    const deadline=Date.now()+(this.options.durationMs ?? 60_000);
    // Explicit admin opt-in only; no business transaction, pool slot, SQL body,
    // customer data or authority mutation enters these process-level metrics.
    const loop=this.runtimeDiagnostics ? monitorEventLoopDelay({resolution:20}) : null;
    const started=performance.now(),cpu=process.cpuUsage();
    let lastRoundTripMs=0,maxRoundTripMs=0;
    loop?.enable();
    const updateRuntime=()=>{
      if(!loop)return;
      const used=process.cpuUsage(cpu);
      this.runtime={elapsedMs:performance.now()-started,cpuUserMs:used.user/1000,
        cpuSystemMs:used.system/1000,eventLoopSamples:loop.count,
        observationSamples:this.samples,eventLoopP99Ms:Number.isFinite(loop.percentile(99)) ? loop.percentile(99)/1e6 : 0,
        eventLoopMaxMs:Number.isFinite(loop.max) ? loop.max/1e6 : 0,
        lastRoundTripMs,maxRoundTripMs};
    };
    try {
      client=(this.options.createClient ?? (()=>new pg.Client({
        connectionString:process.env.DATABASE_URL,
        connectionTimeoutMillis:2000, query_timeout:1000,
        options:"-c default_transaction_read_only=on -c statement_timeout=750 -c application_name=lbc-lock-observer",
      })))();
      let connectionError: unknown;
      client.on("error",error=>{connectionError=error;});
      hardStop=setTimeout(()=>{void close();},Math.max(1,deadline-Date.now()));
      hardStop.unref();
      await client.connect();
      const identity=(await client.query("SELECT pg_is_in_recovery() AS is_replica, pg_backend_pid() AS observer_pid")).rows[0];
      if (identity?.is_replica !== false) {
        this.state="refused_replica";
        this.report({event:"db:primary_lock_capture_unavailable",reason:"PRIMARY_NOT_CONFIRMED"});
        return;
      }
      this.state="capturing";
      this.report({event:"db:primary_lock_capture_started",observerPid:identity.observer_pid,
        primaryConfirmed:true,durationMs:this.options.durationMs ?? 60_000});
      while (Date.now()<deadline && !ended && this.samples<240) {
        if (connectionError) throw connectionError;
        const queryStarted=performance.now();
        let rows:any[];
        try { rows=(await client.query(PRIMARY_LOCK_SNAPSHOT_SQL)).rows; }
        finally {
          lastRoundTripMs=performance.now()-queryStarted;
          maxRoundTripMs=Math.max(maxRoundTripMs,lastRoundTripMs);updateRuntime();
        }
        this.samples++;
        if (rows.length) {
          this.blockedSamples++;
          const snapshot={observedAt:new Date().toISOString(),backends:sanitizeLockSnapshot(rows),
            backendLimitReached:rows.length>=64};
          this.recent.push(snapshot);
          if (this.recent.length>20) this.recent.shift();
          this.report({event:"db:primary_lock_snapshot",...snapshot});
        }
        const remaining=deadline-Date.now();
        if (remaining>0) await new Promise(resolve=>setTimeout(resolve,Math.min(this.options.intervalMs ?? 250,remaining)));
      }
      this.state="completed";
    } catch (error) {
      // A hard observation deadline is completion, not a recovery failure.
      this.state=Date.now()>=deadline ? "completed" : "failed";
      if (this.state === "failed") {
        this.failure=safeDatabaseFailure(error);
        this.report({event:"db:primary_lock_capture_unavailable",reason:"OBSERVATION_FAILED",failure:this.failure});
      }
    } finally {
      updateRuntime();loop?.disable();
      if (hardStop) clearTimeout(hardStop);
      await close();
      this.finishedAt=new Date().toISOString();
      this.report({event:"db:primary_lock_capture_finished",state:this.state,samples:this.samples,
        blockedSamples:this.blockedSamples,...(this.runtime ? {runtime:this.runtime,
          runtimeProcessInstanceId:lockTraceProcessInstanceId()} : {})});
    }
  }
}

export const importLockCapture = new PrimaryLockCapture();
let automaticStarted=false;
export function startAutomaticImportLockCapture() {
  if (automaticStarted || process.env.NODE_ENV!=="production" || process.env.REPLIT_DEPLOYMENT!=="1") return;
  automaticStarted=true;
  importLockCapture.start();
}
