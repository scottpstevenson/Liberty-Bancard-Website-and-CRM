/** Source ledger only. Never substitutes for request/action/role receipts. */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
const reads:unknown[]=[],invalidations:unknown[]=[],controls:unknown[]=[];
const adopted=new Set(["client/src/pages/dashboard/Contacts.tsx","client/src/pages/dashboard/ContactDetail.tsx",
  "client/src/pages/dashboard/ContactsAndLeads.tsx","client/src/pages/dashboard/FinancialHub.tsx",
  "client/src/pages/dashboard/SystemHealthHub.tsx"]);
function visitFile(file:string){
  const text=fs.readFileSync(file,"utf8"),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,
    file.endsWith("tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const imports=new Map<string,string>();
  for(const statement of source.statements){
    if(ts.isImportDeclaration(statement)&&statement.importClause?.namedBindings&&ts.isNamedImports(statement.importClause.namedBindings))
      for(const binding of statement.importClause.namedBindings.elements)
        imports.set(binding.name.text,statement.moduleSpecifier.getText(source));
  }
  const visit=(node:ts.Node)=>{
    const line=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
    if(ts.isCallExpression(node)){
      const name=node.expression.getText(source);
      if(["useQuery","useCrmQuery","useQueries","useInfiniteQuery"].includes(name)){
        const options=node.arguments[0],properties=options&&ts.isObjectLiteralExpression(options)?options.properties:[];
        const property=(key:string)=>properties.find(p=>p.name?.getText(source)===key);
        reads.push({file,line,name,import:imports.get(name)??null,
          queryKey:property("queryKey")?.getText(source)??"computed/grouped; inspect source",
          strategy:property("queryFn")?"custom":imports.get(name)?.includes("use-crm-query")?"scoped wrapper; explicit original URL":"default or grouped; source review required",
          adopted:adopted.has(file),receiptStatus:"source census only"});
      }
      if(/\.(invalidateQueries|removeQueries|cancelQueries)$/.test(name))
        invalidations.push({file,line,operation:name,keyContract:node.arguments[0]?.getText(source)??null});
    }
    if(adopted.has(file)&&(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))){
      const attributes=node.attributes.properties;
      const events=attributes.filter(p=>ts.isJsxAttribute(p)&&/^on(?:Click|Change|ValueChange|CheckedChange|Submit|OpenChange)$/.test(p.name.getText(source)));
      if(events.length){
        const id=attributes.find(p=>ts.isJsxAttribute(p)&&p.name.getText(source)==="data-testid");
        controls.push({file,line,tag:node.tagName.getText(source),testId:id?.getText(source)??null,
          events:events.map(p=>p.name!.getText(source)),owner:"C1 for adopted-control verification; existing B handlers preserved",
          receiptStatus:"UNVERIFIED until matched to actual action/state/role/effect receipt"});
      }
    }
    ts.forEachChild(node,visit);
  };visit(source);
}
function walk(directory:string){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())walk(file);
    else if(/\.tsx?$/.test(file))visitFile(file);
  }
}
walk("client/src");
fs.writeFileSync("docs/certification/stage3-c1/consumer-census.json",JSON.stringify({
  status:"Source denominator, not execution proof; each adopted control still requires a matched receipt",
  reads,invalidations,controls,
},null,2)+"\n");
console.log(`Source census: ${reads.length} read hooks, ${invalidations.length} invalidation/cancel/remove sites, ${controls.length} adopted-source event controls. No behavioral pass inferred.`);
