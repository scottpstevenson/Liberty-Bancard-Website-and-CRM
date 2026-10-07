import {tsImport} from "tsx/esm/api";
await tsImport("./test-stage3-c1-browser.ts",{
  parentURL:import.meta.url,tsconfig:"scripts/tsconfig.ghl-inbound-ui-test.json",
});
