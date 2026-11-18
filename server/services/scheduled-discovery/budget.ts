import {sql} from 'drizzle-orm';

export const DISCOVERY_MONTHLY_LIMIT_MICROS = 50_000_000;
// Published Maps rate $3/1000 places, no free-tier/volume discount assumed.
// https://outscraper.com/pricing/ (reviewed 2026-11-18).
export function discoveryMaximumLiability(unitPrice:unknown,unitType:unknown,limit:number):number {
 if(!Number.isSafeInteger(unitPrice)||Number(unitPrice)<3000||unitType!=='result'
   ||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('DISCOVERY_MONTHLY_BUDGET_PRICING_UNVERIFIED');
 const amount=Number(unitPrice)*limit;
 if(!Number.isSafeInteger(amount)||amount>DISCOVERY_MONTHLY_LIMIT_MICROS)throw new Error('DISCOVERY_MONTHLY_BUDGET_REACHED');
 return amount;
}
/** Same transaction as dispatch marking. Uncertain/failed dispatches keep their
 * full maximum liability; neither retries nor month rollover erase old holds.
 * Only Task 2161 purchases are covered, never unrelated account/manual usage.
 */
export async function reserveDiscoveryMonthlyBudget(tx:{execute:(query:any)=>Promise<any>},runId:string,amount:number) {
 if(!Number.isSafeInteger(amount)||amount<3000||amount>DISCOVERY_MONTHLY_LIMIT_MICROS)throw new Error('DISCOVERY_MONTHLY_BUDGET_PRICING_UNVERIFIED');
 const schedule=(await tx.execute(sql`SELECT monthly_budget_micros FROM discovery_schedules WHERE id FOR UPDATE`)).rows[0];
 if(!schedule)throw new Error('DISCOVERY_MONTHLY_BUDGET_UNCONFIGURED');
 const period=(await tx.execute(sql`SELECT to_char(clock_timestamp() AT TIME ZONE 'America/New_York','YYYY-MM') AS budget_period`)).rows[0].budget_period;
 const prior=(await tx.execute(sql`SELECT COALESCE(sum(budget_reserved_micros),0) amount,
 count(*) FILTER(WHERE submitted_at IS NOT NULL AND budget_month IS NULL)::integer unknown
 FROM discovery_runs WHERE budget_month=${period} OR
 (submitted_at IS NOT NULL AND to_char(submitted_at AT TIME ZONE 'America/New_York','YYYY-MM')=${period})`)).rows[0];
 if(prior.unknown>0)throw new Error('DISCOVERY_MONTHLY_BUDGET_BASELINE_UNRECONCILED');
 if(Number(prior.amount)+amount>Number(schedule.monthly_budget_micros))throw new Error('DISCOVERY_MONTHLY_BUDGET_REACHED');
 const changed=(await tx.execute(sql`UPDATE discovery_runs SET budget_reserved_micros=${amount},budget_month=${period}
 WHERE id=${runId}::uuid AND budget_month IS NULL AND submitted_at IS NULL RETURNING id`)).rows;
 if(changed.length!==1)throw new Error('DISCOVERY_MONTHLY_BUDGET_ALREADY_RESERVED');
}
