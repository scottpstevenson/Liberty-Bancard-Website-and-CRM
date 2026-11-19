"""Read every tracked docs artifact; preserve historical evidence and index its authority."""
import subprocess,pathlib,json,hashlib,re
root=pathlib.Path.cwd(); baseline='d67d24c61acc462931c418e8068624c86144c7ae'
paths=subprocess.check_output(['git','ls-tree','-r','--name-only',baseline,'docs/'],text=True).splitlines(); rows=[]
for p in paths:
 data=subprocess.check_output(['git','show',baseline+':'+p]); text=data.decode('utf-8',errors='replace') if p.endswith(('.md','.txt','.json','.sql','.csv')) else ''
 current=p in ['docs/LIBERTY_BANCARD_MASTER_AUDIT_ROADMAP.md','docs/LIBERTY_BANCARD_KNOWLEDGE_BRIEF.md','docs/certification/phase7/roadmap-status.md']
 cls='living authority' if current else 'historical contract/evidence' if any(x in p for x in ['/certification/','/tasks/','/audits/','/reports/']) else 'retained subsystem reference' if p.endswith('.md') else 'retained supporting artifact'
 rows.append(dict(path=p,sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),classification=cls,owner='current subsystem source and route owner; roadmap controls Phase 8',status='reconciled by Phase 8 current-status overlay' if current else 'retained; historical claims are dated evidence, not recertified runtime facts',controllingReference='docs/certification/phase8/README.md',lastVerifiedSource=baseline,textRead=bool(text),title=next((l.lstrip('# ').strip() for l in text.splitlines() if l.startswith('# ')),None)))
out={'baseline':baseline,'paths':len(rows),'markdown':sum(r['path'].endswith('.md') for r in rows),'method':'all original tracked docs bytes read and hashed; text classified for retention/authority; no blanket behavioral recertification','rows':rows}
current=subprocess.check_output(['git','ls-files','docs/'],text=True).splitlines()
out['additionalArtifacts']=[dict(path=p,classification='Phase 8 current evidence/authority',owner='Phase 8 task',status='scope and executed results stated in evidence, no production certification',controllingReference='docs/certification/phase8/README.md') for p in current if p not in paths]
(root/'docs/certification/phase8/documentation-status-index.json').write_text(json.dumps(out,indent=2)+'\n')
print(out['paths'],out['markdown'])
