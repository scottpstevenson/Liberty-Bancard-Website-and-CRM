import {useCrmQuery} from '@/hooks/use-crm-query';
import {useAuth} from '@/hooks/use-auth';
import {useMutation} from '@tanstack/react-query';
import {apiRequest,queryClient} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {useToast} from '@/hooks/use-toast';
import {InboundAcknowledgementCard} from '@/components/dashboard/InboundAcknowledgementCard';
export function IntakeAutomationStatus(){
 const {user}=useAuth();const {toast}=useToast();
 const key='/api/intake-center/status';
 const read=useCrmQuery<{backgroundProfile:string;enabledAt:string|null;capability:{enabled:boolean;expiresAt?:string|null;sourceClasses:string[]};heartbeat:{at:string;failed:number}|null}>({queryKey:[key],refetchInterval:30000});
 const enable=useMutation({mutationFn:()=>apiRequest('POST','/api/intake-center/enable',{enable:true}),onSuccess:()=>{void queryClient.invalidateQueries({queryKey:[key]});void queryClient.invalidateQueries({queryKey:['/api/admin/inbound-acknowledgements/status']});toast({title:'New intake automation enabled',description:'New submissions only. Cold outreach remains paused.'});},onError:(e:Error)=>toast({title:'Could not enable intake automation',description:e.message,variant:'destructive'})});
 const active=!!read.data?.enabledAt&&read.data.capability.enabled&&(!read.data.capability.expiresAt||Date.parse(read.data.capability.expiresAt)>Date.now())&&['sales_request','support_request','fulfillment_request','partner_application_request','privacy_request','intake_submission_request'].every(c=>read.data!.capability.sourceClasses.includes(c));
 return <details className="rounded-xl border bg-muted/30 p-4" data-testid="intake-automation-status"><summary className="cursor-pointer flex flex-wrap gap-3 items-center font-medium">Intake automation <Badge variant={active?'default':'secondary'}>{read.isError?'Status unavailable':read.isLoading?'Loading…':active?(read.data?.backgroundProfile==='off'?'Configured · worker off':'Enabled for new submissions'):'Setup needed'}</Badge></summary><div className="mt-4 space-y-4"><p className="text-sm text-muted-foreground">Staff alerts, CRM notifications and follow-up tasks run independently of cold outreach. Receipt emails go to the submitted address; referral receipts go to the referrer.</p>{read.isError?<p role="alert">Automation status could not be loaded. Refresh to try again.</p>:<><p className="text-sm">Follow-up worker: {read.data?.heartbeat?`${new Date(read.data.heartbeat.at).toLocaleString()} · ${read.data.heartbeat.failed} sources need retry`:'No heartbeat recorded'}</p>{!active&&user?.role==='admin'&&<Button disabled={enable.isPending||read.isLoading} onClick={()=>enable.mutate()}>Enable new intake receipts &amp; follow-up</Button>}</>}<InboundAcknowledgementCard canControl={user?.role==='admin'}/></div></details>;
}
