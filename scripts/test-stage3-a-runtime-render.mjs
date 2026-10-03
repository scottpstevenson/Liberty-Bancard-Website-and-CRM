import { tsImport } from "tsx/esm/api";
await tsImport("./test-stage3-a-runtime-ui.tsx", {
  parentURL: import.meta.url, tsconfig: "scripts/tsconfig.ghl-inbound-ui-test.json",
});