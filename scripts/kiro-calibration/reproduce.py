#!/usr/bin/env python3
"""Generate, measure and fit a synthetic Kiro/Opus calibration corpus.

Only --measure performs authenticated model calls. Raw logs contain synthetic
prompt data and redacted provider diagnostics; keep them local. Fit uses the
preassigned training set only; heldout samples never choose the coefficient.
"""
import argparse,concurrent.futures,hashlib,importlib.util,json,pathlib,subprocess,sys
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('core',HERE/'core.py');core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--output-dir',type=pathlib.Path,required=True)
 parser.add_argument('--repo',type=pathlib.Path,required=True,help='pi-background-tasks checkout with npm dependencies installed')
 parser.add_argument('--provider-extension',type=pathlib.Path,help='pi-provider-kiro dist/index.js (required by --measure)')
 parser.add_argument('--pi',default='pi',help='Pi executable')
 parser.add_argument('--legacy-pi-version',help='Explicit provenance for preexisting records lacking piVersion; never inferred from current Pi')
 parser.add_argument('--legacy-provider-version',help='Explicit provenance for preexisting records lacking providerVersion')
 modes=parser.add_argument_group('operations');modes.add_argument('--generate-only',action='store_true');modes.add_argument('--measure',action='store_true');modes.add_argument('--fit',action='store_true')
 args=parser.parse_args()
 if args.generate_only and (args.measure or args.fit):parser.error('--generate-only cannot be combined with --measure or --fit')
 if not any([args.generate_only,args.measure,args.fit]):parser.error('choose --generate-only, --measure, --fit, or --measure --fit')
 if args.measure and not args.provider_extension:parser.error('--measure requires --provider-extension')
 root=args.output_dir.resolve();root.mkdir(parents=True,exist_ok=True);repo=args.repo.resolve();core.ROOT=root;core.REPO=repo;core.CWD=root;core.PI=args.pi
 if args.measure and (next(root.glob('*.debug.log'),None) is not None or next(root.glob('*.record.json'),None) is not None):parser.error('--measure requires a fresh output directory without logs/records')
 if args.provider_extension:
  core.PROVIDER=args.provider_extension.resolve();core.PROVIDER_VERSION=json.loads((core.PROVIDER.parent.parent/'package.json').read_text())['version']
 manifest=root/'all_manifest.json'
 if args.fit and not args.measure and not args.generate_only and not manifest.exists():parser.error('--fit requires an existing generated/measured output directory')
 if not manifest.exists():
  rows=generate_all(root,repo)
  manifest.write_text(json.dumps({'schema':'kiro-synthetic-corpus-v2','splitAssignedBeforeMeasurements':True,'purpose':'synthetic calibration only; generated payloads contain no repository data','specs':rows},ensure_ascii=False,indent=2))
 else:rows=json.loads(manifest.read_text())['specs']
 print(f'Generated corpus: {len(rows)} samples; {sum(r["split"]=="train" for r in rows)} train; {sum(r["split"]=="heldout" for r in rows)} heldout',flush=True)
 if args.measure:
  existing=[str(p) for row in rows for p in [root/(row['id']+'.debug.log'),root/(row['id']+'.record.json')] if p.exists()]
  if existing:parser.error('--measure refuses existing logs/records; use a fresh output directory: '+existing[0])
  core.PI_VERSION=subprocess.run([args.pi,'--version'],capture_output=True,text=True,check=True).stdout.strip()
  if not core.PI_VERSION:parser.error('Pi did not report its version')
  # Every manifest is persisted before scheduling the first request.
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   for result in pool.map(core.measure,rows):pass
  subprocess.run([sys.executable,str(HERE/'enrich.py'),str(root)]+(['--legacy-pi-version',args.legacy_pi_version] if args.legacy_pi_version else [])+(['--legacy-provider-version',args.legacy_provider_version] if args.legacy_provider_version else []),check=True)
 if args.fit:
  subprocess.run([sys.executable,str(HERE/'enrich.py'),str(root)]+(['--legacy-pi-version',args.legacy_pi_version] if args.legacy_pi_version else [])+(['--legacy-provider-version',args.legacy_provider_version] if args.legacy_provider_version else []),check=True)
  subprocess.run([sys.executable,str(HERE/'fit.py'),str(root)],check=True)

def generate_all(root,repo):
 rows=core.generate()
 cmd=['node','--import','tsx','--input-type=module','-e','import { buildDelegateChildSystemPrompt, buildDelegateChildPrompt } from "./src/core/delegate/launch.ts"; console.log(JSON.stringify({system:buildDelegateChildSystemPrompt("/tmp/synthetic-delegate/seed.json"),prompt:buildDelegateChildPrompt("SYNTHETIC_SEED_PLACEHOLDER", "Read the synthetic data and reply only OK; do not use tools.")}))']
 # /tmp in the system hint is inert synthetic text; no file there is accessed.
 template=json.loads(subprocess.run(cmd,cwd=repo,capture_output=True,text=True,check=True).stdout)
 def wrap(data,task='synthetic-calibration'):
  seed=json.dumps({'schema_version':'synthetic-delegate-seed-v1','task_id':task,'cwd':'/tmp','system_prompt':'Return only OK. This is synthetic calibration data.','directive':{'text':'Read synthetic evidence and reply only OK. Do not use tools.'},'conversation_projection':{'entries':[{'kind':'text','role':'user','text':data}]}},ensure_ascii=False,separators=(',',':'))
  return template['prompt'].replace('SYNTHETIC_SEED_PLACEHOLDER',seed)
 def sample(name,split,kind,seed,target,prompt,system):
  path=root/(name+'.json');path.write_text(json.dumps({'system':system,'prompt':prompt},ensure_ascii=False));tok=core.tokenize(path);assert tok['localTokens']<=160000
  return {'id':name,'split':split,'kind':kind,'seed':seed,'requestedBytes':target,'path':path.name,'thinkingLevel':'max','promptShape':'actual-delegate-child-wrapper-and-system','systemUtf8Bytes':len(system.encode()),**{k:v for k,v in tok.items() if k!='path'}}
 extension=[]
 for i,(kind,target) in enumerate([('english',70000),('java',150000),('seed_json',210000),('dense_spaced',110000),('portuguese',90000),('typescript',200000),('unicode',120000),('seed_json',170000)]):
  split='train' if i<4 else 'heldout';seed=441000+i;name=f'{split}-max-{i:02d}-{kind}'
  extension.append(sample(name,split,kind,seed,target,wrap(core.content(kind,seed,target)),template['system']))
 (root/'extension_manifest.json').write_text(json.dumps({'reason':'Cover actual delegate system and wrapper with thinking=max; assigned train/heldout before calls','specs':extension},indent=2,ensure_ascii=False));rows.extend(extension)
 large=[]
 for i,(kind,target) in enumerate([('english',400000),('seed_json',400000),('java',350000),('seed_json',350000)]):
  split='train' if i<2 else 'heldout';seed=551000+i;name=f'{split}-large-max-{i:02d}-{kind}'
  large.append(sample(name,split,kind,seed,target,wrap(core.content(kind,seed,target)),template['system']))
 (root/'large_extension_manifest.json').write_text(json.dumps({'reason':'Extend byte domain with larger normal text/seed at thinking=max; split assigned before calls','specs':large},indent=2,ensure_ascii=False));rows.extend(large)
 task='synthetic-incident-calibration';system=template['system'];n=212910-len(system.encode())-len(wrap('',task).encode());data=core.content('english',660001,n+1000).replace('\n',' ')[:n];prompt=wrap(data,task);assert len(system.encode())+len(prompt.encode())==212910
 incident=sample('heldout-incident-exact-212910','heldout','seed_json_english_incident',660001,212910,prompt,system)
 (root/'incident_manifest.json').write_text(json.dumps({'reason':'Exact212910total UTF8bytes replay with actual delegate wrapper/system, additional heldout with unchanged train fit','specs':[incident]},indent=2));rows.append(incident)
 return rows

if __name__=='__main__':
 try:main()
 except (ValueError,RuntimeError,subprocess.CalledProcessError,OSError) as error:
  print('error: '+str(error),file=sys.stderr);sys.exit(2)
