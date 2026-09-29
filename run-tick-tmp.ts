import { processSfpContinuousDiscoveryTick } from "./server/services/cro03/sfp-continuous-discovery";
(async () => {
  const result = await processSfpContinuousDiscoveryTick();
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
