/**
 * Stage 4C1 generic-route fence, over real HTTP (disposable database; no network beyond loopback, no sends).
 *
 * Current SFP package content is a campaign + sequence pair pinned by content hash. The generic editor routes must
 * refuse a one-sided edit with 409 `pinned_package_content` and change nothing, while an unpinned asset still edits
 * and role guards still run first.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 4C1 generic route fence certification" });
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool } = await import("../../server/db");
const express = (await import("express")).default;
const { registerCampaignsRoutes } = await import("../../server/routes/campaigns");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [FNC-${String(checks).padStart(2, "0")}] ${message}`); };

const C = 920001, S = 920002, C2 = 920003, S2 = 920004;
for (const t of ["sfp_campaign_package_versions"]) await pool.query(`DELETE FROM ${t} WHERE campaign_id = ANY($1)`, [[C, C2]]);
await pool.query(`DELETE FROM campaign_steps WHERE campaign_id = ANY($1)`, [[C, C2]]);
await pool.query(`DELETE FROM sequence_steps WHERE sequence_id = ANY($1)`, [[S, S2]]);
await pool.query(`DELETE FROM campaigns WHERE id = ANY($1)`, [[C, C2]]);
await pool.query(`DELETE FROM follow_up_sequences WHERE id = ANY($1)`, [[S, S2]]);
for (const id of [C, C2]) await pool.query(`INSERT INTO campaigns (id,name,status,created_by) VALUES ($1,$2,$3,'cert-admin')`, [id, `FNC campaign ${id}`, id === C ? "paused" : "draft"]);
for (const id of [S, S2]) await pool.query(`INSERT INTO follow_up_sequences (id,name,status,trigger_type,trigger_config,total_steps,created_by) VALUES ($1,$2,'paused','manual','{}'::jsonb,1,'cert-admin')`, [id, `FNC sequence ${id}`]);
const cstep = async (cid: number) => (await pool.query(`INSERT INTO campaign_steps (campaign_id,step_order,step_type,subject,body_template,channel) VALUES ($1,1,'email','Original','<p>Original</p>','email') RETURNING id`, [cid])).rows[0].id as number;
const sstep = async (sid: number) => (await pool.query(`INSERT INTO sequence_steps (sequence_id,step_order,action_type,subject,body) VALUES ($1,1,'email','Original','<p>Original</p>') RETURNING id`, [sid])).rows[0].id as number;
const pc = await cstep(C), ps = await sstep(S), uc = await cstep(C2), us = await sstep(S2);
await pool.query(`INSERT INTO sfp_campaign_package_versions (package_key,vertical,campaign_id,campaign_name,sequence_id,sequence_name,sequence_family,content_hash,lifecycle_state,effective_at,actor_id) VALUES ('sfp.retail.v1','retail',$1,'FNC campaign','$2','x','sfp-v2-cold-retail','hash','current',now(),'cert')`.replace("'$2'", "$2"), [C, S]);

const app = express();
app.use(express.json());
let role: string | null = "admin";
app.use((req: any, _res, next) => {
  req.isAuthenticated = () => role !== null;
  req.user = role ? { id: "cert-admin", role } : undefined;
  next();
});
registerCampaignsRoutes(app);
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;
const call = (method: string, path: string, body?: unknown) => new Promise<{ status: number; json: any }>((resolve, reject) => {
  const data = body === undefined ? undefined : JSON.stringify(body);
  const req = http.request({ host: "127.0.0.1", port, path, method, headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {} }, (res) => {
    let raw = ""; res.on("data", (c) => (raw += c));
    res.on("end", () => { let json: any = null; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode ?? 0, json }); });
  });
  req.on("error", reject); if (data) req.write(data); req.end();
});
const state = async () => JSON.stringify({
  cs: (await pool.query(`SELECT id,subject,body_template FROM campaign_steps WHERE campaign_id=ANY($1) ORDER BY id`, [[C, C2]])).rows,
  ss: (await pool.query(`SELECT id,subject,body FROM sequence_steps WHERE sequence_id=ANY($1) ORDER BY id`, [[S, S2]])).rows,
  c: (await pool.query(`SELECT id,name,description,content_revision FROM campaigns WHERE id=ANY($1) ORDER BY id`, [[C, C2]])).rows,
  s: (await pool.query(`SELECT id,name,version FROM follow_up_sequences WHERE id=ANY($1) ORDER BY id`, [[S, S2]])).rows,
});

const before = await state();
const pinned: Array<[string, string, string, unknown]> = [
  ["PUT campaign", "PUT", `/api/campaigns/${C}`, { name: "Renamed", description: "x" }],
  ["POST campaign step", "POST", `/api/campaigns/${C}/steps`, { stepOrder: 2, stepType: "email", subject: "New", bodyTemplate: "<p>New</p>", channel: "email" }],
  ["PUT campaign step", "PUT", `/api/campaign-steps/${pc}`, { subject: "Changed", bodyTemplate: "<p>Changed</p>" }],
  ["DELETE campaign step", "DELETE", `/api/campaign-steps/${pc}`, undefined],
  ["PUT sequence", "PUT", `/api/sequences/${S}`, { name: "Renamed" }],
  ["POST sequence step", "POST", `/api/sequences/${S}/steps`, { stepOrder: 2, actionType: "email", subject: "New", body: "<p>New</p>" }],
  ["PUT sequence step", "PUT", `/api/sequence-steps/${ps}`, { subject: "Changed", body: "<p>Changed</p>" }],
];
for (const [label, method, path, body] of pinned) {
  const r = await call(method, path, body);
  check(r.status === 409 && r.json?.code === "pinned_package_content" && /package publication/.test(r.json?.message ?? ""), `${label} on a current SFP package asset is refused: 409 pinned_package_content`);
}
check(await state() === before, "None of the refused edits changed any campaign, sequence or step");

// Role guards still run before the fence.
role = "agent";
const asAgent = await call("PUT", `/api/sequence-steps/${ps}`, { subject: "x" });
check(asAgent.status === 403 && asAgent.json?.code !== "pinned_package_content", "An agent is refused by the role guard (403), not by the fence");
role = null;
const anon = await call("PUT", `/api/campaign-steps/${pc}`, { subject: "x" });
check(anon.status === 401, "An unauthenticated caller gets 401");
role = "admin";

// An unpinned pair still edits through the generic routes.
const free = await call("PUT", `/api/sequence-steps/${us}`, { subject: "Changed by editor", body: "<p>Changed by editor</p>" });
check(free.status !== 409 || free.json?.code !== "pinned_package_content", "An unpinned sequence step is not blocked by the fence");
const freeCampaign = await call("PUT", `/api/campaign-steps/${uc}`, { subject: "Changed by editor", bodyTemplate: "<p>Changed by editor</p>" });
check(freeCampaign.json?.code !== "pinned_package_content", "An unpinned campaign step is not blocked by the fence");
const changed = (await pool.query(`SELECT (SELECT subject FROM sequence_steps WHERE id=$1) s, (SELECT subject FROM campaign_steps WHERE id=$2) c`, [us, uc])).rows[0];
check(changed.s === "Changed by editor" && changed.c === "Changed by editor", `Unpinned edits really apply (sequence ${free.status}, campaign ${freeCampaign.status})`);

// Superseded pins no longer fence: only the current version pins.
await pool.query(`UPDATE sfp_campaign_package_versions SET lifecycle_state='superseded', superseded_at=now() WHERE campaign_id=$1`, [C]);
const afterSuper = await call("PUT", `/api/campaign-steps/${pc}`, { subject: "Edited after supersede", bodyTemplate: "<p>x</p>" });
check(afterSuper.json?.code !== "pinned_package_content", "Only a current package version fences; a superseded pin does not");

server.close();
console.log(`\n✓ Stage 4C1 generic-route fence: ${checks} checks passed`);
await pool.end();
