import {tsImport} from "tsx/esm/api";
await tsImport("./test-stage3-c1-query-runtime.tsx",{
  parentURL:import.meta.url,tsconfig:"scripts/tsconfig.ghl-inbound-ui-test.json",
});
