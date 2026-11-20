import {useState} from 'react';
import {useMutation} from '@tanstack/react-query';
import {useCrmActorIdentity,useCrmQuery} from '@/hooks/use-crm-query';
import {useAuth} from '@/hooks/use-auth';
import {apiRequest,queryClient} from '@/lib/queryClient';
import {useToast} from '@/hooks/use-toast';
import {Button} from '@/components/ui/button';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {Badge} from '@/components/ui/badge';
import {EmailPreviewContent} from '@/components/EmailPreviewModal';
import {CrmDataState} from '@/components/crm/CrmPresentation';
import {Skeleton} from '@/components/ui/skeleton';
import {Mail,ClipboardList,RefreshCw} from 'lucide-react';
export type IntakeKind='forms'|'merchants'|'applications'|'introductions'|'referrals'|'merchant_referrals';
type Delivery={state:string;updated_at:string;blocked_reason?:string;last_error?:string;subject?:string;html_body?:string;text_body?:string;attempt_count?:number};
type RecordDetail={source:{name:string|null;email:string|null;status:string;received_at:string};recipientMeaning:string;operation:{ready:boolean}|null;nextSteps:string[];notifications:Array<{id:number;title:string;created_at:string}>;tasks:Array<{id:number;title:string;status:string;assigned_to:string|null;due_date:string|null}>;receipts:Delivery[];alerts:Delivery[];correspondence:Delivery[];href:string};
type Preview={to:string;subject:string;html:string;text:string;hash:string};
const stateLabel=(value:string)=>({accepted:'Accepted by mail transport',sent:'Accepted by mail transport',uncertain:'Delivery outcome unknown — do not resend',blocked:'Waiting / blocked',prepared:'Prepared',attempting:'Attempt in progress',suppressed:'Suppressed',failed:'Failed',pending:'Pending'}[value]??value.replaceAll('_',' '));
function Deliveries({items,empty}:{items:Delivery[];empty:string}) {return items.length?<ul className="space-y-3">{items.map((item,i)=><li key={i} className="rounded-lg border p-3 text-sm space-y-1"><Badge variant="outline">{stateLabel(item.state)}</Badge>{item.subject&&<p className="font-medium">{item.subject}</p>}<p className="text-xs text-muted-foreground">{new Date(item.updated_at).toLocaleString()}{item.attempt_count!==undefined?` · ${item.attempt_count} attempts`:''}</p>{(item.blocked_reason||item.last_error)&&<p>{(item.blocked_reason||item.last_error)?.replaceAll('_',' ')}</p>}{item.html_body&&<details><summary className="cursor-pointer py-2">View recorded email</summary><EmailPreviewContent subject={item.subject} body={item.html_body} showComplianceNotice={false}/></details>}</li>)}</ul>:<p className="text-sm text-muted-foreground">{empty}</p>;}
export function IntakeRecordActions({kind,id}:{kind:IntakeKind;id:string}) {
 const actor=useCrmActorIdentity();
 return <IntakeRecordActionsForActor key={actor} kind={kind} id={id}/>;
}
function IntakeRecordActionsForActor({kind,id}:{kind:IntakeKind;id:string}) {
 const [open,setOpen]=useState(false);const {user}=useAuth();const {toast}=useToast();
 const [subject,setSubject]=useState('Following up on your Liberty Bancard submission');
 const [body,setBody]=useState('Thank you for your submission. Our team is reviewing the information you shared.\n\nIf you would like to discuss the next steps, choose a time to speak with us using the link below.');
 const [preview,setPreview]=useState<Preview|null>(null);const [commandKey,setCommandKey]=useState(()=>crypto.randomUUID());
 const path=`/api/intake-center/records/${kind}/${encodeURIComponent(id)}`;
 const read=useCrmQuery<RecordDetail>({queryKey:[path],enabled:open,refetchInterval:open?15000:false});
 const refresh=()=>queryClient.invalidateQueries({queryKey:[path]});
 const previewEmail=useMutation({mutationFn:async()=>{const res=await apiRequest('POST',`${path}/preview`,{subject,body});return res.json() as Promise<Preview>;},onSuccess:setPreview,onError:(e:Error)=>toast({title:'Preview unavailable',description:e.message,variant:'destructive'})});
 const send=useMutation({mutationFn:async()=>{if(!preview)throw Error('Preview this email first.');const res=await apiRequest('POST',`${path}/send`,{subject,body,previewHash:preview.hash,commandKey});return res.json();},onSuccess:()=>{toast({title:'Email queued',description:'Queued for the receipt worker. Check the timeline for the transport outcome.'});setPreview(null);setCommandKey(crypto.randomUUID());void refresh();},onError:(e:Error)=>toast({title:'Email not queued',description:e.message,variant:'destructive'})});
 const task=useMutation({mutationFn:()=>apiRequest('POST',`${path}/task`,{}),onSuccess:()=>{toast({title:'Follow-up task recorded'});void refresh();},onError:(e:Error)=>toast({title:'Task unavailable',description:e.message,variant:'destructive'})});
 const edit=(which:'subject'|'body',value:string)=>{which==='subject'?setSubject(value):setBody(value);setPreview(null);setCommandKey(crypto.randomUUID());};
 return <><Button variant="outline" size="sm" className="min-h-11 gap-2 whitespace-normal" onClick={e=>{e.stopPropagation();setOpen(true);}} data-testid={`intake-actions-${kind}-${id}`}><ClipboardList className="h-4 w-4 shrink-0"/>Review &amp; next steps</Button>
 <Sheet open={open} onOpenChange={setOpen}><SheetContent onClick={event=>event.stopPropagation()} className="w-full sm:max-w-2xl overflow-y-auto" data-testid="intake-record-drawer"><SheetHeader><SheetTitle>Review &amp; next steps</SheetTitle><SheetDescription>Track this submission, follow-up work and Liberty correspondence.</SheetDescription></SheetHeader>
 {read.isLoading?<Skeleton className="h-80 mt-6"/>:read.isError||!read.data?<CrmDataState state="unavailable" message="Intake record details could not be loaded." onRetry={()=>void read.refetch()}/>:<div className="mt-6 space-y-7">
 <section className="rounded-xl bg-primary p-5 text-primary-foreground"><p className="text-xs uppercase tracking-wider opacity-80">Liberty Bancard · Intake</p><h3 className="mt-2 font-semibold text-xl break-words">{read.data.source.name||'Submission'}</h3><p className="mt-2 text-sm">{(read.data.source.status||'Status not recorded').replaceAll('_',' ')} · received {read.data.source.received_at?new Date(read.data.source.received_at).toLocaleString():'time not recorded'}</p><p className="mt-3 text-sm break-all">{read.data.recipientMeaning}: {read.data.source.email||'No submitted email available'}</p></section>
 <section><h3 className="font-semibold mb-3">Next steps</h3><ol className="space-y-2 list-decimal pl-5 text-sm">{read.data.nextSteps.map(s=><li key={s}>{s}</li>)}</ol><a className="inline-flex min-h-11 items-center text-sm underline mt-2" href={read.data.href}>Open the review worklist</a></section>
 <section><div className="flex justify-between gap-3 items-center mb-3"><h3 className="font-semibold">Follow-up tasks</h3><Button variant="outline" size="sm" disabled={task.isPending} onClick={()=>task.mutate()}>Create / find task</Button></div>{read.data.tasks.length?read.data.tasks.map(t=><a key={t.id} href={`/dashboard/tasks-appointments?tab=tasks&taskId=${t.id}`} className="block border rounded-lg p-3 text-sm mb-2"><span className="font-medium">{t.title}</span><p>{t.status} · {t.assigned_to||'Unassigned — management assignment needed'}</p>{t.due_date&&<p>Due {new Date(t.due_date).toLocaleString()}</p>}</a>):<p className="text-sm text-muted-foreground">No linked follow-up task recorded. Create one here if needed.</p>}</section>
 <section><h3 className="font-semibold mb-3">CRM alerts</h3>{read.data.notifications.length?read.data.notifications.map(n=><p key={n.id} className="text-sm border rounded-lg p-3">{n.title} · {new Date(n.created_at).toLocaleString()}</p>):<p className="text-sm text-muted-foreground">No linked CRM alert recorded for this source.</p>}</section>
 <section><h3 className="font-semibold mb-3">Staff email alerts</h3><p className="text-xs text-muted-foreground mb-2">Recipient: scott@libertybancard.com. Internal alerts remain independent of cold outreach.</p><Deliveries items={read.data.alerts} empty="No staff email alert recorded for this source."/></section>
 <section><h3 className="font-semibold mb-3">Automatic receipt</h3><Deliveries items={read.data.receipts} empty="No receipt attempt recorded. Automatic receipts apply only after activation, and wait for durable review work."/></section>
 <section className="border-t pt-5 space-y-3"><h3 className="font-semibold flex gap-2 items-center"><Mail className="h-4 w-4"/>Email this requester</h3><p className="text-sm text-muted-foreground">Use this for correspondence about the submission. Referrals address the referrer. This does not subscribe anyone to marketing.</p><Label htmlFor={`intake-subject-${kind}-${id}`}>Subject</Label><Input id={`intake-subject-${kind}-${id}`} value={subject} maxLength={180} onChange={e=>edit('subject',e.target.value)}/><Label htmlFor={`intake-message-${kind}-${id}`}>Message</Label><Textarea id={`intake-message-${kind}-${id}`} value={body} maxLength={8000} rows={6} onChange={e=>edit('body',e.target.value)}/><Button variant="outline" disabled={!read.data.source.email||previewEmail.isPending||send.isPending} onClick={()=>previewEmail.mutate()}>Preview email</Button>
 {preview&&<div className="space-y-3 border rounded-xl p-3" data-testid="intake-email-preview"><p className="text-sm break-all">To: {preview.to}</p><EmailPreviewContent subject={preview.subject} body={preview.html} showComplianceNotice={false}/>{user?.role==='admin'?<Button disabled={send.isPending} onClick={()=>send.mutate()} data-testid="intake-send-email">{send.isPending?'Queuing…':'Send this email'}</Button>:<p className="text-sm text-muted-foreground">An administrator can send this previewed email.</p>}</div>}
 </section><section><h3 className="font-semibold mb-3">Correspondence timeline</h3><p className="text-xs text-muted-foreground mb-2">Most recent 20 messages.</p><Deliveries items={read.data.correspondence} empty="No staff correspondence recorded yet."/></section><Button variant="outline" className="gap-2" onClick={()=>void read.refetch()}><RefreshCw className="h-4 w-4"/>Refresh timeline</Button><p className="text-xs text-muted-foreground">Transport acceptance is not confirmation of inbox delivery. An unknown outcome is never resent automatically.</p>
 </div>}
 </SheetContent></Sheet></>;
}
