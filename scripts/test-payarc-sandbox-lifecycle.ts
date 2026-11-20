/**
 * Safe Traditional lifecycle contract entry point. The former credential-detected smoke used
 * assumed /applications routes and could create a provider record without a durable CRM case.
 * Real sandbox acceptance must use the reviewed CRM workflow for a named synthetic case.
 */
if(process.env.PAYARC_SANDBOX_LIVE==='1')throw Error('Use the reviewed, named synthetic CRM acceptance workflow; this command never creates provider applications.');
await import('./certification/test-stage5-payarc-codec');
