import {useEffect,useMemo,useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {CrmDataTable,CrmDetailDrawer,type CrmDataColumn} from '@/components/crm/CrmPresentation';
import {apiRequest} from '@/lib/queryClient';
import {useAuth} from '@/hooks/use-auth';
import {useUrlParam} from '@/hooks/use-url-param';
const URL='/api/scheduled-discovery';
type Definition={id:string;revision:number;vertical:string;county_fips:string;area_type:string;area_key:string;query:string;enabled:boolean;result_limit:number;next_due_at:string;last_attempt_at:string|null;last_retrieved_at:string|null;last_imported_at:string|null;last_state:string|null;last_run_id:string|null;saturated:boolean;covered_through:string|null;preview:any;totals:any};
type Run={id:string;definition_id:string;mode:string;state:string;created_at:string;provider_task_id:string|null;operation_id:string|null;import_execution_id:string|null;import_id:number|null;content_hash:string|null;mapper_version:string|null;matching_policy:string|null;results_expires_at:string|null;next_poll_at:string|null;last_error:string|null;saturated:boolean;preview:any;totals:any;billing_state:string|null;provider_usage_quantity:string|null;provider_usage_unit:string|null;settled_cost_micros:string|null};
type Data={monthlyBudget:{pricingReady:boolean;enrichmentPricingReady:boolean;pricingReason:string|null;legacyMicros:number;unknownOperations:number;committedMicros:number;remainingMicros:number|null;mapsUnitPriceMicros:number|null;canPurchaseMaps:boolean;limitMicros:number;reservedMicros:number;timezone:string;scope:string};downstreamReadiness:{validationPromotionEnabled:boolean;zeroBounce:{ready:boolean;reason:string|null}};program:any;programReason:string|null;schedule:{enabled:boolean;daily_dispatch_count:number;repeat_days:number;timezone:string;last_error?:string|null};definitions:Definition[];totalDefinitions:number;definitionPage:number;definitionPageSize:number;runs:Run[];provider:{ready:boolean;reason:string|null};runtime:{ready:boolean;reason:string|null};worker:{selected:boolean;profile:string;heartbeat:string|null;redisConfigured:boolean};dailyDispatches:number;countPolicy:string;legacyHolds:any[]};
const fmt=(v:string|null|undefined)=>v?new Date(v).toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'}):'Not recorded';
const label=(s:string|null)=>s?s.replaceAll('_',' '):'Never searched';
function RunEvidence({id}:{id:string}) {
 const [open,setOpen]=useState(false);const [offset,setOffset]=useState(0);
 const detail=useQuery<any>({queryKey:[`${URL}/runs/${id}?offset=${offset}`],enabled:open});
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary className="min-h-11 cursor-pointer">Retained row evidence</summary>
  {detail.isLoading&&<p role="status">Loading retained evidence…</p>}{detail.isError&&<p role="alert">Unable to load retained evidence.</p>}
  {detail.data&&<><p className="text-xs">{detail.data.downstream.population}</p>
   <dl className="my-2 grid gap-2 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-3">
    <div><dt>New businesses at import</dt><dd className="font-semibold">{detail.data.totals?.newBusinesses ?? "Import pending"}</dd></div>
    <div><dt>Current verified contact links</dt><dd className="font-semibold">{detail.data.downstream.verifiedContactLinks}</dd></div>
    <div><dt>Qualified primary recipients</dt><dd className="font-semibold">{detail.data.downstream.qualifiedPrimaries ?? "Cohort exceeds reporting limit"}</dd></div>
   </dl><dl className="space-y-2">{['crawl','materialization','preparation','validation'].map(stage=><div key={stage}><dt className="font-medium">{label(stage)}</dt><dd>{detail.data.downstream[stage].length?detail.data.downstream[stage].map((s:any)=>`${label(s.state)}: ${s.businesses??s.candidates??s.contacts??s.intents}${s.has_website===false?' (no website)':''}`).join('; '):'No work recorded'}</dd></div>)}</dl>{detail.data.usage.map((u:any)=><p key={`${u.purpose}:${u.unit}:${u.certainty}`}>{label(u.purpose)}: {u.operations} operations; {u.observed_quantity??'Unknown'} {u.unit??'units'} ({u.certainty}); actual charge unknown.</p>)}</>}
  {detail.data?.rows.map((r:any)=><p key={r.index} className="py-2">Row {r.index+1}: {label(r.state)}{r.reason?` — ${r.reason}`:''}{r.raw?.name?` · ${r.raw.name}`:''}{r.businessId&&<> · <a className="underline" href={`/dashboard/businesses/${r.businessId}`}>Business #{r.businessId}</a></>}</p>)}
  {detail.data?.rows.length===0&&<p>No retained rows on this page.</p>}
  <div className="flex gap-2"><Button variant="outline" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>Previous rows</Button><Button variant="outline" disabled={!detail.data||detail.data.rows.length<25||offset>=75} onClick={()=>setOffset(offset+25)}>Next rows</Button></div>
 </details>;
}
export default function ScheduledDiscoveryPanel(){
 const {user}=useAuth();const admin=user?.role==='admin';const cache=useQueryClient();
 const [filter,setFilter]=useUrlParam('discoveryFilter','',v=>v.length<=100?v:undefined);
 const [page,setPage]=useUrlParam('discoveryPage','1',v=>/^\d+$/.test(v)&&Number(v)>=1&&Number(v)<=1000?v:undefined);
 const read=useQuery<Data>({queryKey:[URL,filter,page],queryFn:async()=>(await apiRequest('GET',`${URL}?filter=${encodeURIComponent(filter)}&page=${page}`)).json(),refetchInterval:15_000});
 const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [selected,setSelected]=useUrlParam('discoveryDefinition','',v=>/^[a-f0-9-]{36}$/.test(v)?v:undefined);
 const [settings,setSettings]=useState({enabled:false,monthlyBudgetUsd:50,dailyDispatchCount:1,repeatDays:30,timezone:'America/New_York'});
 const [settingsDirty,setSettingsDirty]=useState(false);
 const [coverage,setCoverage]=useState('');const [coverageRef,setCoverageRef]=useState('');
 const [slice,setSlice]=useState({areaType:'city',areaKey:'',query:'',resultLimit:100});
 const [reconcileOutcome,setReconcileOutcome]=useState('task');
 const [taskId,setTaskId]=useState('');const [evidence,setEvidence]=useState('');
 const keys=useMemo(()=>new Map<string,string>(),[]);
 const mutation=useMutation({mutationFn:async({method,path,body,paid=false}:{method:string;path:string;body:any;paid?:boolean})=>{
  let key=keys.get(path);if(paid&&!key){key=crypto.randomUUID();keys.set(path,key);}
  return (await apiRequest(method,URL+path,body,paid?{'Idempotency-Key':key!}:undefined)).json();
 },onSuccess:(result,variables)=>{
  setError('');if(variables.paid)keys.delete(variables.path);
  setNotice(result?.reused?'Reused the current or retained run within its repeat window.':variables.paid?'Search request recorded. Dispatch depends on the selected worker and current provider controls.':variables.path.endsWith('/import')?'Retained import requested; no new provider search.':'Saved.');
  if(variables.path==='/schedule')setSettingsDirty(false);
  if(variables.path.endsWith('/coverage')){setCoverage('');setCoverageRef('');}
  if(variables.path.endsWith('/reconcile')){setEvidence('');setTaskId('');}
  if(variables.body.areaType)setSlice({areaType:'city',areaKey:'',query:'',resultLimit:100});
  void cache.invalidateQueries({queryKey:[URL]});
 },onError:(e:Error)=>{setError(e.message);setNotice('');}});
 const act=(path:string,body:any={},method='POST',paid=false)=>mutation.mutate({method,path,body,paid});
 useEffect(()=>{if(read.data&&!settingsDirty)setSettings({enabled:read.data.schedule.enabled,monthlyBudgetUsd:read.data.monthlyBudget.limitMicros/1000000,dailyDispatchCount:read.data.schedule.daily_dispatch_count,repeatDays:read.data.schedule.repeat_days,timezone:read.data.schedule.timezone});},[read.data,settingsDirty]);
 const d=read.data;const definition=d?.definitions.find(x=>x.id===selected);const runs=d?.runs.filter(r=>r.definition_id===selected)??[];
 const definitions=d?.definitions??[];
 const columns:CrmDataColumn<Definition>[]=[
  {id:'query',label:'Search and area',render:r=><><button className="min-h-11 text-left font-medium underline" onClick={()=>setSelected(r.id)}>{r.query}</button><p className="text-xs text-muted-foreground">{r.vertical} · {r.area_type} {r.area_key} · r{r.revision}</p></>},
  {id:'state',label:'State',render:r=><><Badge variant="outline">{r.enabled?label(r.last_state):'Paused definition'}</Badge>{r.saturated&&<p className="text-sm">Saturated / incomplete</p>}<p className="text-xs">Covered through: {fmt(r.covered_through)}</p></>},
  {id:'due',label:'Timing',render:r=><div className="text-xs space-y-1"><p>Next due: {fmt(r.next_due_at)}</p><p>Last attempt: {fmt(r.last_attempt_at)}</p><p>Retrieved: {fmt(r.last_retrieved_at)}</p><p>Imported: {fmt(r.last_imported_at)}</p></div>},
  {id:'outcomes',label:'Outcomes',render:r=><p className="text-sm">{r.totals?`${r.totals.newBusinesses} new / ${r.totals.matchedBusinesses} matched businesses; ${r.totals.contacts} contacts`:r.preview?`Would create ${r.preview.counts.wouldCreate}; match ${r.preview.counts.wouldMatch}; review ${r.preview.counts.needsReview}`:'No results retained'}</p>},
 ];
 return <section className="rounded-lg border bg-card p-4 sm:p-6 space-y-5" aria-labelledby="scheduled-discovery-heading">
  <div className="flex flex-wrap justify-between gap-3"><div><h2 id="scheduled-discovery-heading" className="text-lg font-semibold">Scheduled Outscraper discovery</h2><p className="text-sm text-muted-foreground">Find new businesses in your active program. Preview first or automatically import scheduled results.</p></div><Button variant="outline" onClick={()=>void read.refetch()}>Refresh discovery</Button></div>
  {read.isLoading&&<p role="status">Loading discovery controls…</p>}
  {read.isError&&<div role="alert"><p>Discovery status unavailable. {String((read.error as Error)?.message??'')}</p><Button onClick={()=>void read.refetch()}>Retry discovery</Button></div>}
  {error&&<p role="alert" className="text-sm text-destructive break-words">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
  {d&&<>
   {d.programReason&&<p role="alert">Program unavailable: {d.programReason}. No new search can dispatch.</p>}
   <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
    <div className="rounded-lg border p-3"><dt>Schedule</dt><dd className="font-semibold">{d.schedule.enabled?'Enabled':'Off'}</dd><dd>{d.dailyDispatches} new searches today</dd></div>
    <div className="rounded-lg border p-3"><dt>Provider</dt><dd>{d.provider.ready?'Ready':d.provider.reason??'Unavailable'}</dd><dd>Actual charge: unknown unless independently reconciled.</dd></div>
    <div className="rounded-lg border p-3"><dt>Worker</dt><dd>{d.worker.selected?'Selected':'Not selected'} · {d.worker.redisConfigured?'Redis configured':'Redis missing'}</dd><dd>Heartbeat: {fmt(d.worker.heartbeat)}</dd><dd>Profile: {d.worker.profile}</dd></div>
    <div className="rounded-lg border p-3"><dt>Runtime authority</dt><dd>{d.runtime.ready?'Ready':d.runtime.reason??'Unavailable'}</dd></div>
   </dl>
   <div role="status" className="rounded-lg border p-3 text-sm"><p className="font-medium">CRM-wide Outscraper budget: ${(d.monthlyBudget.limitMicros/1000000).toFixed(2)} per calendar month</p><p>${(d.monthlyBudget.committedMicros/1000000).toFixed(2)} known maximum liability committed · {d.monthlyBudget.timezone}</p>{(!d.monthlyBudget.pricingReady||d.monthlyBudget.unknownOperations>0)&&<p role="alert">New searches blocked: {d.monthlyBudget.pricingReason}. Current reviewed pricing and resolved legacy accounting are required.</p>}{!d.monthlyBudget.enrichmentPricingReady&&<p>Leads &amp; Contacts purchases are blocked until their endpoint-specific price and billing unit are verified.</p>}<p className="text-muted-foreground">{d.monthlyBudget.scope} Existing-task retrieval does not purchase another search.</p></div>
   <p className="text-sm">Selected validation promotion: {d.downstreamReadiness.validationPromotionEnabled?'Enabled':'Off'}. ZeroBounce: {d.downstreamReadiness.zeroBounce.ready?'Ready':d.downstreamReadiness.zeroBounce.reason}. Crawling, contact materialization, recipient preparation and completed validation are separate outcomes.</p>
   <p className="text-xs text-muted-foreground">{d.countPolicy} A county search is a sample, not a business census. Saturated results need narrower city or ZIP slices. Times shown in America/New_York.</p>
   <details className="rounded-lg border p-3"><summary data-testid="discovery-schedule-settings" className="min-h-11 cursor-pointer text-sm font-medium">Schedule and workload settings</summary>
    {!admin&&<p className="text-sm">Read-only access. An administrator manages paid searches and schedules.</p>}
    <form className="grid sm:grid-cols-2 gap-4 py-3" onSubmit={e=>{e.preventDefault();act('/schedule',settings,'PUT');}}>
     <label className="flex items-center gap-3 min-h-11 text-sm"><input type="checkbox" checked={settings.enabled} disabled={!admin} onChange={e=>{setSettingsDirty(true);setSettings({...settings,enabled:e.target.checked});}}/>Enable new scheduled searches</label>
     <label className="text-sm">Monthly CRM Outscraper budget (USD)<Input data-testid="input-outs-monthly-budget" type="number" min={0} max={50} step="0.01" value={settings.monthlyBudgetUsd} disabled={!admin} onChange={e=>{setSettingsDirty(true);setSettings({...settings,monthlyBudgetUsd:Number(e.target.value)});}}/></label>
     <label className="text-sm">Daily new-search count<Input type="number" min={1} max={1000} value={settings.dailyDispatchCount} disabled={!admin} onChange={e=>{setSettingsDirty(true);setSettings({...settings,dailyDispatchCount:Number(e.target.value)});}}/></label>
     <label className="text-sm">Repeat window (days)<Input type="number" min={1} max={365} value={settings.repeatDays} disabled={!admin} onChange={e=>{setSettingsDirty(true);setSettings({...settings,repeatDays:Number(e.target.value)});}}/></label>
     <label className="text-sm">IANA timezone<Input value={settings.timezone} disabled={!admin} onChange={e=>{setSettingsDirty(true);setSettings({...settings,timezone:e.target.value});}}/></label>
     {admin&&<Button data-testid="save-discovery-schedule" disabled={mutation.isPending} type="submit">Save discovery schedule</Button>}
    </form>
   </details>
   {d.schedule.last_error&&<p role="status" className="text-sm">Last worker result: {d.schedule.last_error}</p>}
   {!d.totalDefinitions&&!filter&&<div className="space-y-3"><p>No query definitions for the current program revision.</p>{admin&&<Button onClick={()=>act('/initialize')} disabled={mutation.isPending||!d.program}>Create active-program definitions</Button>}</div>}
   <label className="block text-sm">Filter discovery searches<Input className="mt-1" value={filter} onChange={e=>{setFilter(e.target.value);setPage('1');}} placeholder="Vertical, area or query"/></label>
   <CrmDataTable rows={definitions} columns={columns} mobileCard={r=><div className="p-3 space-y-2"><button onClick={()=>setSelected(r.id)} className="min-h-11 text-left font-semibold underline">{r.query}</button><p>{label(r.last_state)} · {r.enabled?'Enabled':'Paused'}</p><p>Next due: {fmt(r.next_due_at)}</p>{r.saturated&&<p>Saturated / incomplete</p>}<p>{r.vertical} · {r.area_type} {r.area_key}</p></div>}/>
   {!definitions.length&&<p role="status">No discovery searches match this view.</p>}
   <nav aria-label="Discovery search pages" className="flex flex-wrap items-center gap-3 text-sm"><p>{d.totalDefinitions} matching searches · Page {page} of {Math.max(1,Math.ceil(d.totalDefinitions/d.definitionPageSize))}</p><Button variant="outline" disabled={Number(page)<=1} onClick={()=>setPage(String(Number(page)-1))}>Previous searches</Button><Button variant="outline" disabled={Number(page)*d.definitionPageSize>=d.totalDefinitions} onClick={()=>setPage(String(Number(page)+1))}>Next searches</Button></nav>
   <details><summary className="min-h-11 cursor-pointer text-sm">Historical Outscraper holds outside this lane</summary><p className="text-xs text-muted-foreground">Existing reserved/ambiguous operations, never released by this feature.</p>{d.legacyHolds.map((h,i)=><p key={i} className="text-sm">{h.purpose}: {h.operations} operations, {h.units} held units ({h.billing_state}).</p>)}</details>
  </>}
  <CrmDetailDrawer fullWidthMobile dirty={!!slice.areaKey||!!coverage||!!evidence} open={!!selected} onOpenChange={open=>{if(!open)setSelected('');}} title={definition?.query??'Discovery search'} description="Paid provider search, retained results and local import are separate actions.">
   {!definition&&<p role="status">This definition is unavailable in the current program revision.</p>}
   {definition&&<div className="space-y-5 text-sm">
    <p>{definition.vertical} · County {definition.county_fips} · {definition.area_type} {definition.area_key} · revision {definition.revision} · limit {definition.result_limit}</p>
    <p>A paid preview retains provider results without creating businesses or contacts. The same results can later be imported without another paid search. Requests within the repeat window reuse their retained run.</p>
    {admin&&<div className="flex flex-wrap gap-2"><Button disabled={mutation.isPending||!definition.enabled||!d||!d.monthlyBudget.canPurchaseMaps||(d.monthlyBudget.remainingMicros??0)<definition.result_limit*(d.monthlyBudget.mapsUnitPriceMicros??Infinity)||runs.some(r=>['queued','dispatching','pending','submission_unknown','results_retained','importing'].includes(r.state))} onClick={()=>act(`/definitions/${definition.id}/preview`,{},'POST',true)}>Run paid preview — no import</Button><Button variant="outline" disabled={mutation.isPending} onClick={()=>act(`/definitions/${definition.id}`,{enabled:!definition.enabled},'PUT')}>{definition.enabled?'Pause definition':'Enable definition'}</Button></div>}
    {admin&&<details><summary className="min-h-11 cursor-pointer">Add narrower slice or coverage</summary>
     <form className="space-y-3" onSubmit={e=>{e.preventDefault();act(`/definitions/${definition.id}`,slice,'PUT');}}>
      <label>Area type<select className="block min-h-11 w-full rounded-md border bg-background p-2" value={slice.areaType} onChange={e=>setSlice({...slice,areaType:e.target.value})}><option value="city">City</option><option value="zip">ZIP</option></select></label>
      <label className="block">City or ZIP key<Input required value={slice.areaKey} onChange={e=>setSlice({...slice,areaKey:e.target.value})}/></label><label className="block">Exact narrower query<Input required value={slice.query} onChange={e=>setSlice({...slice,query:e.target.value})}/></label><label className="block">Result limit<Input type="number" min={1} max={100} value={slice.resultLimit} onChange={e=>setSlice({...slice,resultLimit:Number(e.target.value)})}/></label><Button type="submit" disabled={mutation.isPending}>Add discovery slice</Button>
     </form>
     <form className="mt-5 space-y-3" onSubmit={e=>{e.preventDefault();const parsed=new Date(coverage);if(Number.isNaN(parsed.getTime())){setError('Enter a valid coverage date and timezone.');return;}act(`/definitions/${definition.id}/coverage`,{coveredThrough:parsed.toISOString(),reference:coverageRef});}}>
      <p>Coverage suppresses only this definition, revision and exact area. It creates no import and makes no cost claim.</p><label className="block">Covered through (include timezone)<Input required placeholder="2026-12-01T00:00:00-05:00" value={coverage} onChange={e=>setCoverage(e.target.value)}/></label><label className="block">Coverage reference<Input value={coverageRef} onChange={e=>setCoverageRef(e.target.value)}/></label><Button disabled={mutation.isPending} type="submit">Record exact-area coverage</Button>
     </form>
    </details>}
    <h3 className="font-semibold">Recent retained search runs (up to 100)</h3>{!runs.length&&<p>No search run recorded.</p>}
    {runs.map(r=><article className="rounded-lg border p-3 space-y-2 break-words" key={r.id}>
     <p className="font-semibold">{label(r.state)} · {r.mode} · {fmt(r.created_at)}</p><p className="font-mono text-xs">Run {r.id}</p>
     {r.last_error&&<p role="status">{r.last_error}</p>}{r.saturated&&<p>Saturated: incomplete coverage. Add narrower areas.</p>}
     <p>Provider task: {r.provider_task_id??'Not confirmed'} · Next poll: {fmt(r.next_poll_at)}</p><p>Retention bound: {fmt(r.results_expires_at)}</p>
     <p>Observed units: {r.provider_usage_quantity??'Unknown'} {r.provider_usage_unit??''}; estimate: {r.settled_cost_micros===null?'Unknown':`$${(Number(r.settled_cost_micros)/1e6).toFixed(4)}`}; actual charge: unknown.</p>
     {r.preview&&<p>Preview: would create {r.preview.counts.wouldCreate}, match {r.preview.counts.wouldMatch}, needs review {r.preview.counts.needsReview}, duplicates {r.preview.counts.duplicates}, out of scope {r.preview.counts.outOfScope}, unresolved {r.preview.counts.unresolved}, invalid {r.preview.counts.invalid}.</p>}
     {r.totals&&<p>Committed: {r.totals.newBusinesses} new businesses, {r.totals.matchedBusinesses} matched businesses, {r.totals.contacts} distinct contacts. {r.totals.excludedRows} rows excluded before import. Crawling and selected validation have independent eligibility and readiness.</p>}
     <p className="text-xs font-mono">Artifact {r.content_hash??'Not retained'} · {r.mapper_version??'—'} · {r.matching_policy??'—'}</p><p className="text-xs">Operation: {r.operation_id??'Not dispatched'} · Import: {r.import_execution_id??'Not imported'}{r.import_id&&<> · <a className="underline inline-flex min-h-11 items-center" href={`/dashboard/lead-ops?tab=imports&importHistory=${r.import_id}`}>Open import history #{r.import_id}</a></>}</p>{r.content_hash&&<RunEvidence id={r.id}/>}
     {admin&&r.content_hash&&(['preview_ready','results_retained','importing'].includes(r.state)||(r.state==='completed'&&r.totals?.importedRows===0))&&<Button disabled={mutation.isPending} onClick={()=>act(`/runs/${r.id}/import`)}>{r.state==='completed'?'Reprocess retained results — no new search':'Import retained results — no new search'}</Button>}
     {admin&&r.state==='submission_unknown'&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();act(`/runs/${r.id}/reconcile`,{...(reconcileOutcome==='task'?{taskId}:{provenNotDispatched:true}),evidence});}}><p>Do not resubmit. Verify the original provider task, then attach its ID.</p><label className="block">Reconciliation outcome<select className="block min-h-11 w-full rounded-md border bg-background p-2" value={reconcileOutcome} onChange={e=>setReconcileOutcome(e.target.value)}><option value="task">Attach verified original task</option><option value="not-dispatched">Record non-dispatch evidence</option></select></label>{reconcileOutcome==='task'?<label className="block">Verified provider task ID<Input required value={taskId} onChange={e=>setTaskId(e.target.value)}/></label>:<p>The local run closes. Its provider hold remains for ledger reconciliation. This action does not buy another search.</p>}<label className="block">Verification evidence<Input required minLength={20} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label><Button type="submit" disabled={mutation.isPending}>{reconcileOutcome==='task'?'Attach verified original task':'Record non-dispatch evidence'}</Button></form>}
    </article>)}
   </div>}
  </CrmDetailDrawer>
 </section>;
}
