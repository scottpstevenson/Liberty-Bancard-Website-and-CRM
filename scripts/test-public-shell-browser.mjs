import {tsImport} from "tsx/esm/api";
await tsImport("./test-public-shell-browser.ts",{
  parentURL:import.meta.url,tsconfig:"scripts/tsconfig.ghl-inbound-ui-test.json",
});
