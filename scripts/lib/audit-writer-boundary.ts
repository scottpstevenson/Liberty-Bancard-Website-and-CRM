import ts from "typescript";
import {readFileSync,readdirSync} from "node:fs";
import path from "node:path";

const canonicalNames=new Set(["sanitizeAuditPayload","sanitizeChannelAuditSnapshot","scrubErrorString"]);
const trustedWriters=new Set(["server/storage/audit.ts","server/services/audit-change.ts"]);
const keys=(n:ts.ObjectLiteralExpression)=>n.properties.map(p=>p.name?.getText().replace(/["']/g,"")??"...").sort().join(",");
/** SQL/ORM callsites only: strings in tests, comments and source-inspection
 * assertions are not production writers. Import proximity is not a proof. */
export function auditWriterBoundary(source:string,file:string) {
 const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const findings:string[]=[],imports=new Set<string>(),variables=new Map<string,ts.VariableDeclaration[]>();
 let checked=0,journals=0,payloadFree=0;
 function collect(n:ts.Node){
  if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)&&n.moduleSpecifier.text.endsWith("audit-sanitizer")){
   const bindings=n.importClause?.namedBindings;
   if(bindings&&ts.isNamedImports(bindings))for(const e of bindings.elements)if(canonicalNames.has((e.propertyName??e.name).text))imports.add(e.name.text);
  }
  if(ts.isVariableDeclaration(n)&&ts.isObjectBindingPattern(n.name)&&n.initializer&&/import\(["'][^"']*audit-sanitizer["']\)/.test(n.initializer.getText(sf)))
   for(const e of n.name.elements)if(ts.isIdentifier(e.name)&&canonicalNames.has((e.propertyName??e.name).getText(sf)))imports.add(e.name.text);
  if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name))variables.set(n.name.text,[...(variables.get(n.name.text)??[]),n]);
  ts.forEachChild(n,collect);
 }collect(sf);
 const scope=(n:ts.Node):ts.Node=>{let p=n.parent;while(p&&!ts.isFunctionLike(p)&&!ts.isSourceFile(p))p=p.parent;return p??sf;};
 function safe(n:ts.Node|undefined,seen=new Set<ts.Node>()):boolean {
  if(!n||seen.has(n))return false;seen.add(n);
  if(ts.isCallExpression(n)){
   if(ts.isIdentifier(n.expression)&&imports.has(n.expression.text))return true;
   if(ts.isPropertyAccessExpression(n.expression)&&canonicalNames.has(n.expression.name.text)
     && /import\(["'][^"']*audit-sanitizer["']\)/.test(n.expression.expression.getText(sf)))return true;
  }
  if(ts.isIdentifier(n)){
   const matches=(variables.get(n.text)??[]).filter(v=>v.pos<n.pos&&(scope(v)===scope(n)||scope(v)===sf));
   const v=matches.sort((a,b)=>b.pos-a.pos)[0];return v?safe(v.initializer,seen):false;
  }
  if(ts.isParenthesizedExpression(n)||ts.isAsExpression(n)||ts.isTypeAssertionExpression(n)||ts.isNonNullExpression(n))return safe(n.expression,seen);
  return false;
 }
 function journal(n:ts.CallExpression):boolean {
  if(file!=="server/services/onboarding-preparation-command.ts"||!n.arguments[0]||!ts.isObjectLiteralExpression(n.arguments[0]))return false;
  const object=n.arguments[0];const props=new Map(object.properties.filter(ts.isPropertyAssignment).map(p=>[p.name.getText(sf),p.initializer]));
  if(!/key\((input|plan)\.commandId\)/.test(props.get("entityKey")?.getText(sf)??""))return false;
  const detail=props.get("details"),action=props.get("action")?.getText(sf);
  if(action==="acceptedAction"&&detail?.getText(sf)==="frozen"){
   const frozen=(variables.get("frozen")??[]).find(v=>v.initializer&&ts.isObjectLiteralExpression(v.initializer));
   if(!frozen?.initializer||!ts.isObjectLiteralExpression(frozen.initializer))return false;
   // This is an ownership/replay journal, not a diagnostic snapshot: its
   // verified assignee must survive replay. No arbitrary request body is stored.
   return keys(frozen.initializer)==="baseDate,commandId,contactId,onboardingDealId,owner,payloadHash,planning,selectedDealId,sourceDealId,sourceVersion"
     && frozen.initializer.properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(sf)==="owner"&&p.initializer.getText(sf)==="auth.owner");
  }
  return action==="stepAction"&&!!detail&&ts.isObjectLiteralExpression(detail)
   && ["checklistIds,key","key,taskId"].includes(keys(detail));
 }
 function visit(n:ts.Node){
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)){
   let sql="",payloads:ts.Node[]=[],isWrite=false;
   if(["query","execute"].includes(n.expression.name.text)&&n.arguments[0]){
    const a=n.arguments[0];
    if(ts.isStringLiteral(a)||ts.isNoSubstitutionTemplateLiteral(a))sql=a.text;
    else if(ts.isTaggedTemplateExpression(a)&&a.tag.getText(sf)==="sql")sql=a.template.getText(sf);
    isWrite=/\bINSERT\s+INTO\s+audit_logs\b/i.test(sql);
    if(isWrite){const serializers=(x:ts.Node)=>{if(ts.isCallExpression(x)&&["JSON.stringify","json","safeJson"].includes(x.expression.getText(sf))&&x.arguments[0])payloads.push(x.arguments[0]);ts.forEachChild(x,serializers);};serializers(n);}
   }else if(n.expression.name.text==="values"&&/\.insert\(auditLogs\)$/.test(n.expression.expression.getText(sf))){
    isWrite=true;let o=n.arguments[0];while(o&&(ts.isAsExpression(o)||ts.isParenthesizedExpression(o)))o=o.expression;if(o&&ts.isObjectLiteralExpression(o))for(const p of o.properties)if(ts.isPropertyAssignment(p)&&["details","beforeState","afterState"].includes(p.name.getText(sf)))payloads.push(p.initializer);
   }
   if(isWrite){checked++;if(!trustedWriters.has(file)){
    if(journal(n))journals++;
    else if(payloads.length ? payloads.some(p=>!safe(p)) :
      // Typed SQL builders contain numeric IDs, code-only reasons and fixed
      // metadata; their only dynamic text crosses the canonical scrubber.
      ["server/services/canonical-recipient-preparation-worker.ts","server/services/cro03a-policy-initializer.ts"].includes(file)
       ? !(()=>{let found=false;const v=(x:ts.Node)=>{if(safe(x))found=true;ts.forEachChild(x,v);};v(n);return found;})()
       : !(file==="server/services/scheduled-discovery/service.ts"&&sql.includes("discovery_retained_import_requested")&&!/\b(details|before_state|after_state)\b/.test(sql))) {
      findings.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1}`);
    }else if(!payloads.length)payloadFree++;
   }}
  }ts.forEachChild(n,visit);
 }visit(sf);return {checked,journals,payloadFree,findings};
}
export function scanProductionAuditWriters(root=process.cwd()){
 const total={checked:0,journals:0,payloadFree:0,findings:[] as string[]};
 const walk=(directory:string)=>{for(const e of readdirSync(directory,{withFileTypes:true})){
  const p=path.join(directory,e.name);if(e.isDirectory()){if(e.name!=="tests")walk(p);}
  else if(p.endsWith(".ts")&&!p.endsWith(".test.ts")){const r=auditWriterBoundary(readFileSync(p,"utf8"),path.relative(root,p).replaceAll(path.sep,"/"));total.checked+=r.checked;total.journals+=r.journals;total.payloadFree+=r.payloadFree;total.findings.push(...r.findings);}
 }};walk(path.join(root,"server"));return total;
}
