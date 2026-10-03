import { tsImport } from "tsx/esm/api";
await tsImport("./test-ghl-inbound-sync-ui.tsx", {
  parentURL: import.meta.url, tsconfig: "scripts/tsconfig.ghl-inbound-ui-test.json",
});