import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import {readTabularImportWithCoordinates} from "../../server/services/tabular-import-reader";
const directory=process.argv[2] ?? "/tmp/canonical-enrichment-workbooks";
if(!path.resolve(directory).startsWith("/tmp/"))throw new Error("PRIVATE_TMP_FIXTURE_DIRECTORY_REQUIRED");
mkdirSync(directory,{recursive:true,mode:0o700});
const names=[
  "Outscraper-20261002160911s8d6b_1791037870877.xlsx",
  "Outscraper-20261002160955s00ed_1791037870876.xlsx",
  "Outscraper-20261002161052s68e5_1791037870877.xlsx",
  "Outscraper-20261002161147s2b94_1791037870876.xlsx",
  "Outscraper-20261002161239s8aab_1791037870874.xlsx",
];
const files=[];let count=0;
for(const [index,name] of names.entries()){
  const {rows}=await readTabularImportWithCoordinates(readFileSync(path.join("attached_assets",name)),name);
  const json=path.join(directory,`source-${index}.json`);
  writeFileSync(json,JSON.stringify(rows),{mode:0o600});files.push({name,json,rows:rows.length});count+=rows.length;
}
if(count!==2914)throw new Error("PROVIDER_RECOVERY_FIXTURE_POPULATION_MISMATCH");
writeFileSync(path.join(directory,"manifest.json"),JSON.stringify({files}),{mode:0o600});
console.log(`PRIVATE_PROVIDER_RECOVERY_INPUT_READY files=${files.length} rows=${count}`);
