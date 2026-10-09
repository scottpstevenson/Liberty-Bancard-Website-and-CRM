import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
const routes=JSON.parse(fs.readFileSync("client/src/lib/crm-route-registry.generated.json","utf8")).filter((route:any)=>route.owner==="C4");
const panels=JSON.parse(fs.readFileSync("docs/certification/stage3-c1/panel-dispositions.json","utf8")).filter((panel:any)=>panel.owner==="C4");
const seen=new Set<string>(),files:any[]=[],controls:any[]=[];
function resolve(from:string,name:string) {
  const base=name.startsWith("@/") ? path.join("client/src",name.slice(2))
    : name.startsWith(".") ? path.join(path.dirname(from),name) : null;
  if(!base)return;
  return [base,...[".tsx",".ts",".jsx",".js","/index.tsx","/index.ts"].map(extension=>base+extension)]
    .find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());
}
function scan(file:string) {
  file=path.normalize(file);
  if(seen.has(file)||!file.startsWith("client/"))return;
  seen.add(file);
  const text=fs.readFileSync(file,"utf8"),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  files.push({file,sha256:createHash("sha256").update(text).digest("hex")});
  const imports:string[]=[];
  function visit(node:ts.Node) {
    if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier))imports.push(node.moduleSpecifier.text);
    if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)) {
      const name=node.tagName.getText(ast);
      const attrs=node.attributes.properties.filter(ts.isJsxAttribute);
      const handlers=attrs.filter(attribute=>/^on(?:Click|Submit|Change|ValueChange|OpenChange|KeyDown)$/.test(attribute.name.getText(ast)));
      if(handlers.length || /^(Button|Input|Select|TabsTrigger|DialogTrigger|SheetTrigger|DropdownMenuItem|Checkbox|Switch|Link|a|button|input|select|textarea)$/.test(name)){
        const line=ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1;
        controls.push({file,line,element:name,attributes:attrs.map(attribute=>attribute.getText(ast)),
          handlers:handlers.map(attribute=>attribute.getText(ast)),dynamicExpression:node.parent.getText(ast).slice(0,500),
          verdict:"SOURCE_EXPRESSION_ONLY",actualRoleObjectHandlerStateActionEvidence:"UNVERIFIED"});
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
  for(const name of imports){const dependency=resolve(file,name);if(dependency)scan(dependency);}
}
for(const route of routes)if(route.componentPolicy?.source && fs.existsSync(route.componentPolicy.source))scan(route.componentPolicy.source);
for(const file of ["client/src/components/crm/MerchantOperationsNav.tsx","client/src/pages/dashboard/ReportingHub.tsx",
  "client/src/pages/dashboard/ContactDetail.tsx","client/src/pages/mobile/MobileInbox.tsx","client/src/pages/mobile/MobilePipeline.tsx"])scan(file);
fs.mkdirSync("docs/certification/stage3-c4",{recursive:true});
fs.writeFileSync("docs/certification/stage3-c4/source-inventory.json",JSON.stringify({
  sourceHead:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
  assignment:{routes:routes.length,historicalPanels:panels.length},
  qualification:"Retained registry/panel lineage plus reachable source JSX expressions. Dynamic maps are not expanded into invented controls. NOT actual mounted control, handler, guard, action, native or whole-task acceptance.",
  routes,panels,files,controls,
},null,2)+"\n");
console.log(`C4 retained assignment ${routes.length}/${panels.length}; ${controls.length} source expressions in ${files.length} reachable files; dynamic control/action inventory remains unverified.`);
