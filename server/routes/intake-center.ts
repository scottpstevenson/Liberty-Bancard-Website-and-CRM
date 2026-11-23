import type {Express} from 'express';
import {z} from 'zod';
import {pool} from '../db';
import {requireRole} from '../replit_integrations/auth';
import {serverError} from '../utils/server-error';
import {intakeKinds,canonicalIntakeIdentity,readIntakeRecord,listRecentIntakeTriage,previewIntakeCorrespondence,queueIntakeCorrespondence,intakeAutomationStatus,enableIntakeAutomation,createIntakeFollowupTask} from '../services/intake-center';
const route=z.object({kind:z.enum(intakeKinds),id:z.string().max(40)});
const content=z.object({subject:z.string().trim().min(1).max(180).refine(v=>!/[\r\n]/.test(v)),body:z.string().trim().min(1).max(8000)}).strict();
export function registerIntakeCenterRoutes(app:Express){
 app.use('/api/intake-center',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 app.get('/api/intake-center/merchant-referrals',requireRole('admin','manager'),async(req,res)=>{try{const page=z.coerce.number().int().min(1).max(100000).parse(req.query.page??1);const rows=(await pool.query("SELECT r.id,r.referred_name,r.referred_company,r.status,r.created_at,u.email AS referrer FROM merchant_referrals r LEFT JOIN merchant_profiles p ON p.id=r.referrer_profile_id LEFT JOIN users u ON u.id=p.user_id ORDER BY r.created_at DESC,r.id DESC LIMIT 26 OFFSET $1",[(page-1)*25])).rows;res.json({items:rows.slice(0,25),hasMore:rows.length>25});}catch(e){if(e instanceof z.ZodError)return res.status(400).json({message:'Invalid page.'});serverError(res,e);}});
 app.use('/api/intake-center/records/:kind/:id',requireRole('admin','manager'),async(req,res,next)=>{
  try {if((req.user as any).role!=='admin'&&req.params.kind==='forms'){
   const row=(await pool.query("SELECT source_class FROM inbound_requests WHERE id::text=$1",[req.params.id])).rows[0];
   if(row?.source_class==='privacy_request')return res.status(403).json({message:'Privacy-request correspondence is available only to administrators.'});
  }next();}catch(e){serverError(res,e);}
 });
 app.get('/api/intake-center/triage/:kind',requireRole('admin','manager'),async(req,res)=>{
  const kind=z.enum(intakeKinds).safeParse(req.params.kind);
  if(!kind.success)return res.status(400).json({message:'Invalid intake category.'});
  try {res.json(await listRecentIntakeTriage(kind.data,(req.user as any).role==='admin'));}
  catch(e){serverError(res,e);}
 });
 app.get('/api/intake-center/status',requireRole('admin','manager'),async(_req,res)=>{try{res.json(await intakeAutomationStatus());}catch(e){serverError(res,e);}});
 app.post('/api/intake-center/enable',requireRole('admin'),async(req,res)=>{try{z.object({enable:z.literal(true)}).strict().parse(req.body);res.json(await enableIntakeAutomation((req.user as any).id));}catch(e){if(e instanceof z.ZodError)return res.status(400).json({message:'Confirm enabling new intake receipts and follow-up.'});serverError(res,e);}});
 app.get('/api/intake-center/records/:kind/:id',requireRole('admin','manager'),async(req,res)=>{try{const p=await canonicalIntakeIdentity(route.parse(req.params));const record=await readIntakeRecord(p.kind,p.id);if(!record)return res.status(404).json({message:'Intake record unavailable.'});res.json(record);}catch(e){if(e instanceof z.ZodError)return res.status(400).json({message:'Invalid intake record.'});serverError(res,e);}});
 app.post('/api/intake-center/records/:kind/:id/task',requireRole('admin','manager'),async(req,res)=>{try{const p=await canonicalIntakeIdentity(route.parse(req.params));const task=await createIntakeFollowupTask(p.kind,p.id);if(!task)return res.status(404).json({message:'Intake record unavailable.'});res.json(task);}catch(e){serverError(res,e);}});
 app.post('/api/intake-center/records/:kind/:id/preview',requireRole('admin','manager'),async(req,res)=>{try{const p=await canonicalIntakeIdentity(route.parse(req.params));const c=content.parse(req.body);const preview=await previewIntakeCorrespondence(p.kind,p.id,c.subject,c.body);if(!preview)return res.status(409).json({message:'No submitted contact email is available for this record.'});res.json(preview);}catch(e){if(e instanceof z.ZodError)return res.status(400).json({message:'Enter a subject and message within the permitted length.'});serverError(res,e);}});
 app.post('/api/intake-center/records/:kind/:id/send',requireRole('admin'),async(req,res)=>{try{const p=await canonicalIntakeIdentity(route.parse(req.params));const c=content.extend({previewHash:z.string().regex(/^[0-9a-f]{64}$/),commandKey:z.string().uuid()}).parse(req.body);res.json(await queueIntakeCorrespondence({...p,...c,actor:(req.user as any).id}));}catch(e){if(e instanceof z.ZodError)return res.status(400).json({message:'Preview the email and provide a valid send command.'});if(e instanceof Error&&/Enable intake|changed|command already/.test(e.message))return res.status(409).json({message:e.message});serverError(res,e);}});
}
