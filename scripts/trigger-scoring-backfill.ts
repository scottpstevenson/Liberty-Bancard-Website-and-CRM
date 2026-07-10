import { startScoringJob, getScoringProgress } from '../server/services/contact-scoring-job';

async function main() {
  const current = await getScoringProgress();
  if (current.status === 'running') {
    console.log('Job already running:', current);
    return;
  }
  console.log('Current status:', current.status, '— starting backfill...');
  await startScoringJob({ mode: 'backfill', batchSize: 500, adminUserId: 'system-trigger' });
  console.log('Backfill started. Monitor at /dashboard/activation → Contact Scoring panel.');
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
