// Runs the Stage 4A static-markup UI tests (renderToStaticMarkup on pure view components; not a browser/jsdom mount).
import { tsImport } from "tsx/esm/api";
for (const file of [
  "./test-ghl-sync-status-render.tsx",
  "./test-stage4a-catalog-ui.tsx",
  "./test-stage4a-identity-health-ui.tsx",
]) {
  console.log(`--- ${file}`);
  await tsImport(file, { parentURL: import.meta.url, tsconfig: "scripts/tsconfig.ghl-inbound-ui-test.json" });
}
