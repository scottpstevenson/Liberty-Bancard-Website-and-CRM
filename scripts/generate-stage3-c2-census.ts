/** Complete-set retention and transitive source controls. Not runtime acceptance. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
import assert from "node:assert/strict";
import routes from "../client/src/lib/crm-route-registry.generated.json";
import { contactAreaSections,contactSections } from "../client/src/lib/crm-destination-state";
const output="docs/certification/stage3-c2";
fs.mkdirSync(`${output}/inputs`,{recursive:true});
const correction="attached_assets/LIBERTY_TASK_2073_C2_REPLIT_AUDIT_CORRECTIONS_2026-10-07_1791404174529.md";
const text=fs.readFileSync(correction,"utf8");
assert.equal(crypto.createHash("sha256").update(text).digest("hex"),"1431a97cd1a48538e3dbf722e03b6f95eddf1b4d32e35b02a30f1fbd30205d6e");
fs.copyFileSync(correction,`${output}/inputs/corrections.md`);
const assigned=routes.filter(route=>route.owner==="C2");
assert.equal(assigned.length,25);
const panels=JSON.parse(fs.readFileSync("docs/certification/stage3-c1/panel-dispositions.json","utf8"))
  .filter((row:any)=>row.owner==="C2");
assert.equal(panels.length,30);
const claims=text.split("\n").filter(line=>/^\| (CRM3-\d+|REF-\d+) \|/.test(line)).map(line=>{
  const cells=line.split("|").map(s=>s.trim()).filter(Boolean);
  return {id:cells[0],originalScope:cells[1],historicalRepairGroup:cells.length===4?cells[2]:null,
    correctionScope:cells.at(-1),owner:"C2 composition; existing A/B facts/access/actions; C3/C4 interior/native boundaries retained",
    disposition:"Candidate source work and bounded receipts only; not globally closed"};
});
assert.equal(claims.length,30);
const roots=["Overview","MyDay","Contacts","ContactsAndLeads","ContactDetail","CompanyDetail","Pipeline","CommsHub",
  "Tasks","TasksAppointments","Calendar","Notifications","CallOutcome","ReviewComplete","AiChat","BinLookup",
  "StageRules","NbaPriorityPage","MobileHome","MobileTasks","MobileInbox","MobileContacts","MobileContactDetail","MobilePipeline"];
const sourceFiles:string[]=[];
function walk(directory:string){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.posix.join(directory,entry.name);
    if(entry.isDirectory())walk(file);
    else if(/\.(tsx?|jsx?)$/.test(file))sourceFiles.push(file);
  }
}
walk("client/src");
const pending=sourceFiles.filter(file=>roots.includes(path.basename(file).replace(/\.[^.]+$/,"")));
const seen=new Set<string>(),controls:any[]=[],reads:any[]=[],invalidations:any[]=[];
const resolveImport=(file:string,specifier:string)=>{
  const base=specifier.startsWith("@/")?`client/src/${specifier.slice(2)}`:
    specifier.startsWith(".")?path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier)):null;
  if(!base)return null;
  return [base,`${base}.tsx`,`${base}.ts`,`${base}/index.tsx`,`${base}/index.ts`].find(file=>sourceFiles.includes(file));
};
while(pending.length){
  const file=pending.pop()!;
  if(seen.has(file) || file.startsWith("client/src/components/ui/"))continue;
  seen.add(file);
  const code=fs.readFileSync(file,"utf8");
  const source=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,file.endsWith("tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  for(const node of source.statements)if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){
    const imported=resolveImport(file,node.moduleSpecifier.text);if(imported)pending.push(imported);
  }
  const interior=/contact-detail-tabs\/(Documents|Onboarding|Rfi|Tickets|LiveProcessing|Processing|Chargebacks|Churn|Nps)/i.test(file) ||
    /components\/(BoardingPanel|LiveProcessingTab|OnboardingStagesChecklist|RfiTab|TerminalEconomicsCard)\./.test(file);
  const companyEvidence=/contact-detail-tabs\/(CompanyIntelligence|SalesIntelPanel|SalesPrep)/.test(file);
  const sharedPresentation=/components\/crm\/(CrmPresentation|employee-crm-context)\./.test(file);
  const owner=interior?"C4 existing interior; C2 outer guard/context":
    companyEvidence?"C3 evidence/preparation interior; C2 composition/context":
    sharedPresentation?"C1 presentation primitive; C2 adopted workspace binding":
    "C2 consumer; retained shared A/B command authority";
  const visit=(node:ts.Node)=>{
    const line=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
    if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
      const attrs=node.attributes.properties.filter(ts.isJsxAttribute);
      const events=attrs.filter(a=>/^on(Click|Submit|Change|ValueChange|CheckedChange|OpenChange|KeyDown|Pointer|Drag|Drop)/.test(a.name.getText(source)));
      const tag=node.tagName.getText(source);
      if(events.length || /^(Button|Input|Select|SelectTrigger|TabsTrigger|Textarea|Checkbox|Switch|a|button|input|textarea|summary)$/.test(tag)){
        const testId=attrs.find(a=>a.name.getText(source)==="data-testid")?.initializer?.getText(source);
        controls.push({id:`C2-CONTROL-${controls.length+1}`,file,line,element:tag,testId:testId??null,owner,
          events:events.map(e=>({event:e.name.getText(source),binding:e.initializer?.getText(source)})),
          disabled:attrs.find(a=>a.name.getText(source)==="disabled")?.initializer?.getText(source)??null,
          disposition:"NOT_EXECUTED: source control row requires action/state/role/keyboard receipt; mounted or static inventory is not a pass"});
      }
    }
    if(ts.isCallExpression(node)){
      const name=node.expression.getText(source);
      if(/^(useQuery|useCrmQuery|useInfiniteQuery|useCrmInfiniteQuery|useMutation)$/.test(name))
        reads.push({file,line,name,call:node.getText(source).slice(0,5000),owner});
      if(/\.(invalidateQueries|cancelQueries|removeQueries|setQueryData)$/.test(name))
        invalidations.push({file,line,call:node.getText(source),owner});
    }
    ts.forEachChild(node,visit);
  };visit(source);
}
const write=(name:string,data:unknown)=>fs.writeFileSync(`${output}/${name}.json`,JSON.stringify(data,null,2)+"\n");
write("ownership",{status:"Source retention, not acceptance",routes:assigned,panels,claims,
  qualifiedCLs:["CL09","CL10","CL16","CL17","CL18"].map(id=>({id,qualification:"Historical reference only; no renewed native/runtime closure"})),
  contact:{areas:contactAreaSections,keys:contactSections},
  globalAccounting:{originalFindings:95,repairGroups:14,tasks:8,qualification:"Preserved common portable register; C2 bundles/subclaims are not added unique defects or closure"},
  correctionSha256:"1431a97cd1a48538e3dbf722e03b6f95eddf1b4d32e35b02a30f1fbd30205d6e"});
write("controls",{status:"Source inventory only; no functional percentage or pass denominator",sourceFiles:[...seen].sort(),controls,reads,invalidations});
const csv=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;
fs.writeFileSync(`${output}/control-action-crosswalk.csv`,
  ["id,file,line,kind,testId,events,owner,status,requiredEvidence",
   ...controls.map(control=>[
     control.id,control.file,control.line,control.element,control.testId,JSON.stringify(control.events),
     control.owner,control.disposition,
     "Real authorized UI interaction, registered handler/readback or explicitly blocked existing owner; rendering is not action proof",
   ].map(csv).join(","))].join("\n")+"\n");
console.log(`C2 retention:25 routes/30 panels/25 keys/30 claims; ${controls.length} source controls (${seen.size} transitive files), no runtime acceptance inferred`);
