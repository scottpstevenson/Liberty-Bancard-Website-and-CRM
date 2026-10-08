import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";

/** Actual persisted Passport sessions/CSRF, private listener, no inherited
 * customer/provider credentials. Call before importing application modules. */
export async function stage3BHttpFixture(register: (app: Express) => Promise<void>,
  authDependencies?:Parameters<typeof import("../../server/replit_integrations/auth/replitAuth").setupAuth>[1],
  options?:{interactivePassword?:string;emailPrefix?:string}) {
  // The canonical runner owns its suite namespace. This fixture owns a
  // separate descendant, just as canonical migration/server wrappers do.
  // Never reuse or release the runner's reservation.
  assert.ok(process.env.TEST_REDIS_PREFIX, "A disposable parent namespace is required");
  process.env.TEST_REDIS_PREFIX += `http_fixture_${randomUUID().replaceAll("-", "")}_`;
  const isolation = await assertDisposableTestInfrastructure({
    operation: "Stage 3 B registered lifecycle/workflow fixture", requireRedis: true, reserveRedisNamespace: true,
  });
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  let base = "";
  let responseLoss:{method:string;path:string;mode:"socket"|"truncate"}|null=null;
  let responseLossCount=0;
  const responseFaultEvents:Array<{event:string;method:string;path:string;status?:number;mode?:string}>=[];
  // Deny before database-bound application/auth/route imports, not only once
  // the listener is ready. Test isolation never restores product approval gates.
  globalThis.fetch = (async (input: any, init: any) => {
    if (!base || !String(input).startsWith(`${base}/`)) { externalCalls++; throw new Error("FIXTURE_PROVIDER_DENIED"); }
    return originalFetch(input, init);
  }) as typeof fetch;
  const { db, pool } = await import("../../server/db");
  const { default: express } = await import("express");
  const { default: cookieParser } = await import("cookie-parser");
  const { default: bcrypt } = await import("bcryptjs");
  const { setupAuth } = await import("../../server/replit_integrations/auth");
  const { registerAuthRoutes } = await import("../../server/replit_integrations/auth/routes");
  const { csrfTokenEndpoint } = await import("../../server/middleware/csrf");
  const prefix = `stage3b-${randomUUID()}`;
  if(options?.interactivePassword)assert.ok(options.interactivePassword.length>=16,"Temporary interactive test password must have at least 16 characters");
  const password = options?.interactivePassword ?? `fixture-${randomUUID()}`;
  const passwordHash = await bcrypt.hash(password, 4);
  const roles = ["admin", "manager", "agent", "other", "merchant", "affiliate", "partner"] as const;
  const userId = (role: string) => `${prefix}-${role}`;
  const email = (role: string) => `${options?.emailPrefix?`${options.emailPrefix}-${role}`:userId(role)}@example.test`;
  let server: ReturnType<Express["listen"]> | undefined;
  const sessions = new Map<string, { cookie: string; token: string }>();
  const close = async () => {
    globalThis.fetch = originalFetch;
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await isolation.releaseRedisReservation();
    await pool.end();
  };
  try {
    for (const role of roles) await pool.query(`INSERT INTO users(id,email,password_hash,role,auth_provider,email_verified)
      VALUES($1,$2,$3,$4,'local',NOW())`, [userId(role), email(role), passwordHash, role === "other" ? "agent" : role]);
    const app = express(); app.use(express.json()); app.use(cookieParser());
    await setupAuth(app,authDependencies); registerAuthRoutes(app);
    app.get("/api/csrf-token", csrfTokenEndpoint);
    // Same order as production: session/auth and CSRF (setupAuth), then the
    // global object fence, then registered CRM handlers. No inline-check inference.
    const { crmObjectAccessGuard } = await import("../../server/services/crm-object-access");
    app.use(crmObjectAccessGuard);
    // Drop one successful reply only AFTER the real registered handler has
    // completed its writes. This proves response-loss recovery, not a mocked
    // success or a request denied before dispatch.
    app.use((req,res,next)=>{
      const json=res.json.bind(res);
      const method=req.method,path=new URL(req.originalUrl,"http://isolated.invalid").pathname;
      res.json=((body:unknown)=>{
        if(responseLoss?.path===path)responseFaultEvents.push({event:"matched-path",method,path,status:res.statusCode,mode:responseLoss.mode});
        if(responseLoss?.method===method && responseLoss.path===path && res.statusCode<300){
          const mode=responseLoss.mode;responseLoss=null;responseLossCount++;
          responseFaultEvents.push({event:"executed",method,path,status:res.statusCode,mode});
          if(mode==="socket")res.destroy();
          else {res.setHeader("Content-Type","application/json");res.end('{"receipt":');}
          return res;
        }
        return json(body);
      }) as typeof res.json;
      next();
    });
    // Freshness wraps the final transport-loss shim, so the actual owner's
    // cache/version contract completes even when the socket reply is lost.
    const { crmFactFreshnessMiddleware } = await import("../../server/services/crm-fact-freshness");
    app.use(crmFactFreshnessMiddleware);
    await register(app);
    server = await new Promise<any>(resolve => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    base = `http://127.0.0.1:${(server!.address() as any).port}`;
    globalThis.fetch = (async (input: any, init: any) => {
      if (!String(input).startsWith(`${base}/`)) { externalCalls++; throw new Error("FIXTURE_PROVIDER_DENIED"); }
      return originalFetch(input, init);
    }) as typeof fetch;
    async function login(role: string) {
      const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email(role), password }) });
      assert.equal(response.status, 200, `actual ${role} fixture login`);
      let cookie = response.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
      const csrf = await fetch(`${base}/api/csrf-token`, { headers: { Cookie: cookie } });
      const token = (await csrf.json()).token;
      cookie = [...cookie.split("; "), ...csrf.headers.getSetCookie().map(v => v.split(";")[0])]
        .filter((v, i, all) => !all.slice(i+1).some(later => later.split("=")[0] === v.split("=")[0])).join("; ");
      sessions.set(role, { cookie, token });
      return { status: response.status, body: await response.json() };
    }
    async function request(role: string, method: string, path: string, body?: unknown, csrf = true, headers:Record<string,string>={}) {
      const session = sessions.get(role);
      const response = await fetch(base + path, { method,
        headers: { "Content-Type": "application/json", ...(session ? { Cookie: session.cookie } : {}),
          ...(session && csrf ? { "X-CSRF-Token": session.token } : {}),...headers },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), headers: response.headers };
    }
    for (const role of roles) await login(role);
    return { app, db, pool, prefix, password, passwordHash, base, userId, email, roles,
      request, login, sessions, close, originalFetch, externalCalls: () => externalCalls,
      responseLossCount:()=>responseLossCount,
      responseFaultEvents,
      loseNextSuccessfulResponse:(method:string,path:string,mode:"socket"|"truncate"="socket")=>{
        assert.equal(responseLoss,null,"An armed response fault must execute before another is installed");
        responseLoss={method,path,mode};
        responseFaultEvents.push({event:"armed",method,path,mode});
      } };
  } catch (error) { await close(); throw error; }
}
