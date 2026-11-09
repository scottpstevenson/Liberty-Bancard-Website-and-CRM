/**
 * Validity rules for the public-site lab performance measurement (scripts/check-public-perf.ts).
 *
 * A performance gate that reads a failed measurement as "0 ms" passes the worst pages. The in-page
 * observers therefore start at `null`, and a sample only counts when the page actually painted and the
 * app finished mounting: LCP finite and greater than zero, CLS finite and not negative, the document
 * ready with a rendered h1, and no navigation timeout. A route whose samples are not all valid is
 * reported INVALID and fails the check; it is never "within budget".
 */

export const LCP_BUDGET_MS = 2500;
export const CLS_BUDGET = 0.1;

/** Script injected before any page script. LCP starts as null so "no sample" is distinguishable from 0. */
export const PERF_OBSERVER_SOURCE = String.raw`(()=>{
  window.__perf={lcp:null,cls:0,clsObserved:false};
  try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__perf.lcp=e.startTime;}).observe({type:"largest-contentful-paint",buffered:true});}catch(e){}
  try{window.__perf.clsObserved=true;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__perf.cls+=e.value;}).observe({type:"layout-shift",buffered:true});}catch(e){window.__perf.clsObserved=false;}
})();`;

/** Evaluated in the page after settling: is the document ready with exactly the rendered content we measure? */
export const PERF_READINESS_SOURCE = String.raw`(()=>({
  ready: document.readyState==="complete" && document.querySelectorAll("main h1").length>=1,
  h1Count: document.querySelectorAll("h1").length,
}))()`;

export interface RawPerfSample {
  lcp: unknown;
  cls: unknown;
  clsObserved?: unknown;
  ready: unknown;
  navigationTimedOut?: boolean;
}

export type SampleVerdict =
  | { valid: true; lcpMs: number; cls: number }
  | { valid: false; reason: string };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function classifySample(raw: RawPerfSample): SampleVerdict {
  if (raw.navigationTimedOut) return { valid: false, reason: "navigation timed out before the page settled" };
  if (raw.ready !== true) return { valid: false, reason: "page was not ready (document incomplete or no rendered h1 in main)" };
  if (raw.lcp === null || raw.lcp === undefined) return { valid: false, reason: "no largest-contentful-paint sample was recorded" };
  if (!finite(raw.lcp)) return { valid: false, reason: `largest-contentful-paint is not a finite number (${String(raw.lcp)})` };
  if (raw.lcp <= 0) return { valid: false, reason: `largest-contentful-paint must be greater than 0 (got ${raw.lcp})` };
  if (raw.clsObserved === false) return { valid: false, reason: "layout-shift observer was not available" };
  if (!finite(raw.cls)) return { valid: false, reason: `cumulative layout shift is not a finite number (${String(raw.cls)})` };
  if (raw.cls < 0) return { valid: false, reason: `cumulative layout shift cannot be negative (got ${raw.cls})` };
  return { valid: true, lcpMs: raw.lcp, cls: raw.cls };
}

export type RouteStatus = "within budget" | "over budget" | "invalid";

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export interface RouteSummary {
  status: RouteStatus;
  lcpMs: number | null;
  cls: number | null;
  invalidReasons: string[];
}

/**
 * Median of the valid samples, or INVALID when there are fewer than `minValidRuns` samples or any sample
 * is invalid. Over-budget is judged on the median only after every sample proved valid.
 */
export function summarizeRoute(samples: readonly SampleVerdict[], minValidRuns = 1): RouteSummary {
  const invalid = samples.filter((s): s is { valid: false; reason: string } => !s.valid);
  const valid = samples.filter((s): s is { valid: true; lcpMs: number; cls: number } => s.valid);
  if (invalid.length > 0 || valid.length < Math.max(1, minValidRuns)) {
    const reasons = invalid.map((s) => s.reason);
    if (valid.length < Math.max(1, minValidRuns) && invalid.length === 0) reasons.push(`only ${valid.length} valid samples (need ${minValidRuns})`);
    return { status: "invalid", lcpMs: null, cls: null, invalidReasons: reasons };
  }
  const lcpMs = Math.round(median(valid.map((s) => s.lcpMs)));
  const cls = Number(median(valid.map((s) => s.cls)).toFixed(4));
  return { status: lcpMs > LCP_BUDGET_MS || cls > CLS_BUDGET ? "over budget" : "within budget", lcpMs, cls, invalidReasons: [] };
}
