import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {getTableConfig} from 'drizzle-orm/pg-core';
import {discoverySchedules,discoveryDefinitions,discoveryRuns,discoveryArtifacts,discoveryLane,discoveryCoverage} from '../../../shared/schema';
export async function verifyDiscoverySchema(pool:Pool){
 let columns=0,indexes=0,checks=0,foreignKeys=0;
 for(const table of [discoverySchedules,discoveryDefinitions,discoveryRuns,discoveryArtifacts,discoveryLane,discoveryCoverage]){
  const config=getTableConfig(table);
  const observed=(await pool.query("SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",[config.name])).rows;
  assert.equal(observed.length,config.columns.length,`${config.name} column count`);
  for(const column of config.columns){const actual=observed.find(c=>c.column_name===column.name);assert(actual,`${config.name}.${column.name}`);assert.equal(actual.is_nullable,column.notNull?'NO':'YES');columns++;}
  const constraints=(await pool.query('SELECT conname,contype,convalidated FROM pg_constraint WHERE conrelid=$1::regclass',[config.name])).rows;
  assert.equal(constraints.filter(c=>c.contype==='f').length,config.foreignKeys.length);foreignKeys+=config.foreignKeys.length;
  for(const constraint of config.checks){assert(constraints.some(c=>c.contype==='c'&&c.conname===constraint.name&&c.convalidated),`${config.name} check ${constraint.name}`);checks++;}
  for(const index of config.indexes){const actual=(await pool.query('SELECT indisvalid,indisunique FROM pg_index WHERE indexrelid=to_regclass($1)',[index.config.name])).rows[0];assert(actual?.indisvalid,`${config.name} index ${index.config.name}`);assert.equal(actual.indisunique,index.config.unique);indexes++;}
  for(const column of config.columns.filter(c=>c.isUnique)){
   const actual=(await pool.query(`SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
    WHERE i.indrelid=$1::regclass AND i.indisunique AND i.indnkeyatts=1 AND a.attname=$2`,[config.name,column.name])).rows;
   assert(actual.length,`${config.name}.${column.name} uniqueness`);
  }
 }
 const subject=(await pool.query("SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass('provider_operations_scheduled_discovery_subject_idx')")).rows[0];assert(subject?.indisvalid);
 console.log('PASS TASK2161_SCHEMA_PARITY',JSON.stringify({tables:6,columns,indexes:indexes+1,checks,foreignKeys}));
}
