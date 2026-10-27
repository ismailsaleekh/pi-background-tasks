"""Verify recorded transport and provenance before fitting; never relabel old runs."""
import argparse,datetime,hashlib,json,math,pathlib,re,sys
from fractions import Fraction
sys.excepthook=lambda kind,value,trace: print('error: '+str(value),file=sys.stderr)
p=argparse.ArgumentParser();p.add_argument('output_dir',type=pathlib.Path);p.add_argument('--legacy-pi-version');p.add_argument('--legacy-provider-version');args=p.parse_args();root=args.output_dir;out=[]
manifest=json.loads((root/'all_manifest.json').read_text());specs=manifest['specs']
if not manifest.get('splitAssignedBeforeMeasurements'):raise ValueError('Split was not committed before measurement')
expected={x['id']:x for x in specs}
if any(not x['id'].startswith(x['split']+'-') for x in specs):raise ValueError('Changed predetermined split identity')
if len(expected)!=49 or sum(x['split']=='train' for x in specs)!=30 or sum(x['split']=='heldout' for x in specs)!=19:raise ValueError('Expected fixed49sample corpus:30train19heldout')
actual={x.name[:-len('.record.json')] for x in root.glob('*.record.json')}
if actual!=set(expected):raise ValueError('Missing or unexpected measurement records: '+str(actual.symmetric_difference(expected)))
def count(v):return isinstance(v,int) and not isinstance(v,bool) and v>=0
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
for sid,assigned in expected.items():
 x=json.loads((root/(sid+'.record.json')).read_text());sample=json.loads((root/assigned['path']).read_text());debug=(root/(sid+'.debug.log')).read_text();sections={}
 for key in ['split','kind','seed','localTokens','promptTokens','systemTokens']:
  if x.get(key)!=assigned.get(key):raise ValueError(f'{sid}: record changed preassigned {key}')
 for key,actual_hash in [('systemSha256',digest(sample['system'])),('promptSha256',digest(sample['prompt'])),('combinedSha256',hashlib.sha256(sample['system'].encode()+b'\0'+sample['prompt'].encode()).hexdigest())]:
  if x.get(key)!=actual_hash:raise ValueError(f'{sid}: payload integrity failure {key}')
 for name in ['request.init','request.send']:
  matches=list(re.finditer(r'\['+re.escape(name)+r'\]\s*',debug))
  if not matches:raise ValueError(f'{sid}: missing {name}')
  sections[name],_=json.JSONDecoder().raw_decode(debug[matches[-1].end():])
 init=sections['request.init'];state=sections['request.send']['request'].get('conversationState',{});content=state.get('currentMessage',{}).get('userInputMessage',{}).get('content','')
 if x.get('provider')!='kiro' or x.get('model')!='claude-opus-4-5' or init.get('model')!='claude-opus-4-5' or init.get('contextWindow')!=200000:raise ValueError(f'{sid}: unexpected provider/model/window')
 for key,legacy in [('piVersion',args.legacy_pi_version),('providerVersion',args.legacy_provider_version)]:
  if not isinstance(x.get(key),str) or not x[key]:
   if not legacy:raise ValueError(f'{sid}: missing {key}; supply explicit --legacy-... provenance for historical records')
   x[key]=legacy;x[key+'Source']='legacy_explicit_argument'
  else:x.setdefault(key+'Source','recorded_at_measurement')
 if not all(count(x.get(k)) for k in ['reportedInput','cacheRead','cacheWrite']) or x['reportedInput']<=0:raise ValueError(f'{sid}: missing/invalid input/cache counts')
 pct=x.get('rawContextPercent');pct_ok=isinstance(pct,(int,float)) and not isinstance(pct,bool) and math.isfinite(pct) and 0<=pct<=100
 if x.get('countOrigin')=='percentage_derived' and not pct_ok:raise ValueError(f'{sid}: missing/invalid percent')
 if x.get('countOrigin') not in ['percentage_derived','metadata_token_usage']:raise ValueError(f'{sid}: unknown count origin')
 x.update({'catalogContextWindowTokens':init['contextWindow'],'wireContentUtf8Bytes':len(content.encode()),'wireContentSha256':digest(content),'wireContainsExactPrompt':content.endswith(sample['prompt']),'wireContainsExactSystem':sample['system'] in content,'wireHistoryEntries':len(state.get('history',[])),'wireToolCount':init.get('toolCount'),'providerThinkingEnabled':init.get('thinkingEnabled'),'percentageDerivedTokensCeil':math.ceil(Fraction(str(pct))*init['contextWindow']/100) if pct_ok else None})
 if not x.get('usable') or x.get('failure') or not x['wireContainsExactPrompt'] or not x['wireContainsExactSystem'] or x['wireToolCount']!=0 or x['wireHistoryEntries']!=0:raise ValueError(f'{sid}: failed measurement/transport integrity')
 if x.get('contextWindowTokens')!=200000:raise ValueError(f'{sid}: mismatched recorded context window')
 out.append(x)
fixture={'schema':'kiro-calibration-measurements-v2','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'providerVersions':sorted({x['providerVersion'] for x in out}),'piVersions':sorted({x['piVersion'] for x in out}),'tokenizer':'cl100k_base','records':out}
(root/'records-enriched.json').write_text(json.dumps(fixture,ensure_ascii=False,indent=2));print('Verified',len(out),'transport/provenance records; no source records rewritten')
