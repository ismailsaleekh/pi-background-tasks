"""Offline rejection checks; no model calls are made."""
import json,pathlib,subprocess,sys
root=pathlib.Path(sys.argv[1]);repo=pathlib.Path(sys.argv[2]);cli=pathlib.Path(__file__).with_name('reproduce.py')
base=[sys.executable,str(cli),'--output-dir',str(root),'--repo',str(repo)]
def run(extra,expected):
 p=subprocess.run(base+extra,capture_output=True,text=True);assert p.returncode==expected,(p.returncode,p.stdout,p.stderr);return p
p=run(['--fit'],2);assert 'missing piVersion' in p.stderr
p=run(['--measure','--provider-extension','/nonexistent/dist/index.js'],2);assert 'fresh output directory' in p.stderr
record=root/'train-00-english-v0.record.json';old=record.read_text()
try:
 x=json.loads(old);x.pop('cacheRead');record.write_text(json.dumps(x));p=run(['--fit','--legacy-pi-version','1.4.0'],2);assert 'missing/invalid input/cache counts' in p.stderr
 x=json.loads(old);x['usable']=False;x['failure']='synthetic rejected measurement';record.write_text(json.dumps(x));p=run(['--fit','--legacy-pi-version','1.4.0'],2);assert 'failed measurement/transport integrity' in p.stderr
 x=json.loads(old);x['promptSha256']='bad';record.write_text(json.dumps(x));p=run(['--fit','--legacy-pi-version','1.4.0'],2);assert 'payload integrity failure' in p.stderr
finally:record.write_text(old)
manifest=root/'all_manifest.json';old=manifest.read_text()
try:
 x=json.loads(old);x['specs'][0]['split']='heldout';manifest.write_text(json.dumps(x));p=run(['--fit','--legacy-pi-version','1.4.0'],2);assert 'Changed predetermined split identity' in p.stderr
finally:manifest.write_text(old)
run(['--fit','--legacy-pi-version','1.4.0'],0)
summary=json.loads((root/'fit-summary.json').read_text());assert summary['numerator']==194 and summary['trainCount']==30 and summary['heldoutCount']==19 and summary['heldoutCovered']==19
print('PASS: stale-log refusal, explicit historical provenance, missing-count/failed-measurement/hash/split refusals, exact-rational fit194/100+512')
