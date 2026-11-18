import type {Express,Request,Response} from 'express';
import {z} from 'zod';
import {isDashboardUser,requireRole} from '../replit_integrations/auth';
import {serverError} from '../utils/server-error';
import {initializeDiscoveryDefinitions,discoveryStatus,discoveryRunDetail,createDiscoveryRun,updateDiscoverySchedule,updateDiscoveryDefinition,recordDiscoveryCoverage,requestRetainedDiscoveryImport,reconcileDiscoverySubmission} from '../services/scheduled-discovery/service';
import {validateTimezone} from '../services/scheduled-discovery/policy';
const uuid=z.string().uuid();const actor=(req:Request)=>String((req.user as any).id);
const schedule=z.object({enabled:z.boolean(),dailyDispatchCount:z.number().int().min(1).max(1000),repeatDays:z.number().int().min(1).max(365),timezone:z.string().min(1).max(80).refine(v=>{try{validateTimezone(v);return true;}catch{return false;}},'Invalid IANA timezone')}).strict();
const definition=z.object({enabled:z.boolean().optional(),resultLimit:z.number().int().min(1).max(100).optional(),areaType:z.enum(['city','zip']).optional(),areaKey:z.string().trim().min(1).max(100).optional(),query:z.string().trim().min(1).max(500).optional()}).strict();
const coverage=z.object({coveredThrough:z.string().datetime(),reference:z.string().trim().max(500).optional()}).strict();
const reconcile=z.object({taskId:z.string().regex(/^[A-Za-z0-9_-]{1,160}$/).optional(),provenNotDispatched:z.boolean().optional(),evidence:z.string().trim().min(20).max(2000)}).strict().refine(x=>!!x.taskId!==!!x.provenNotDispatched,'Choose one reconciliation outcome');
export function registerScheduledDiscoveryRoutes(app:Express){
 const handle=(fn:(req:Request)=>Promise<any>)=>async(req:Request,res:Response)=>{
  res.setHeader('Cache-Control','no-store');try{res.json(await fn(req));}catch(e:any){
   if(e instanceof z.ZodError)return void res.status(400).json({message:e.issues[0].message});
   if(/^DISCOVERY_|^SFP_PAID_BLOCKED/.test(e.message))return void res.status(/NOT_FOUND/.test(e.message)?404:409).json({message:e.message});
   serverError(res,e,'scheduled_discovery');
  }
 };
 app.get('/api/scheduled-discovery',isDashboardUser,requireRole('admin','manager'),handle(req=>discoveryStatus(z.string().max(100).parse(req.query.filter??''),z.coerce.number().int().min(1).max(1000).parse(req.query.page??1))));
 app.get('/api/scheduled-discovery/runs/:id',isDashboardUser,requireRole('admin','manager'),handle(req=>discoveryRunDetail(uuid.parse(req.params.id),z.coerce.number().int().min(0).max(100).parse(req.query.offset??0))));
 app.post('/api/scheduled-discovery/initialize',isDashboardUser,requireRole('admin'),handle(req=>initializeDiscoveryDefinitions(actor(req))));
 app.put('/api/scheduled-discovery/schedule',isDashboardUser,requireRole('admin'),handle(req=>updateDiscoverySchedule(actor(req),schedule.parse(req.body))));
 app.put('/api/scheduled-discovery/definitions/:id',isDashboardUser,requireRole('admin'),handle(req=>updateDiscoveryDefinition(uuid.parse(req.params.id),actor(req),definition.parse(req.body))));
 app.post('/api/scheduled-discovery/definitions/:id/coverage',isDashboardUser,requireRole('admin'),handle(req=>recordDiscoveryCoverage(uuid.parse(req.params.id),actor(req),coverage.parse(req.body))));
 app.post('/api/scheduled-discovery/definitions/:id/preview',isDashboardUser,requireRole('admin'),handle(req=>{
  z.object({}).strict().parse(req.body);return createDiscoveryRun(uuid.parse(req.params.id),'preview',actor(req),uuid.parse(req.get('Idempotency-Key')));
 }));
 app.post('/api/scheduled-discovery/runs/:id/import',isDashboardUser,requireRole('admin'),handle(async req=>{z.object({}).strict().parse(req.body);await requestRetainedDiscoveryImport(uuid.parse(req.params.id),actor(req));return {queued:true};}));
 app.post('/api/scheduled-discovery/runs/:id/reconcile',isDashboardUser,requireRole('admin'),handle(req=>reconcileDiscoverySubmission(uuid.parse(req.params.id),actor(req),reconcile.parse(req.body))));
}
