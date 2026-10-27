"""Fit exact integer/rational forecasts from fixed train assignments only."""
import datetime,hashlib,json,math,pathlib,sys
from fractions import Fraction
sys.excepthook=lambda kind,value,trace: print('error: '+str(value),file=sys.stderr)
root=pathlib.Path(sys.argv[1]);fixture=json.loads((root/'records-enriched.json').read_text());rows=fixture['records'];manifest=json.loads((root/'all_manifest.json').read_text());specs=manifest['specs'];assigned={r['id']:r for r in specs}
if any(not x['id'].startswith(x['split']+'-') for x in specs):raise ValueError('Changed predetermined split identity')
if not manifest.get('splitAssignedBeforeMeasurements') or len(assigned)!=49 or len(rows)!=49 or {r['id'] for r in rows}!=set(assigned):raise ValueError('Fit requires all49preassigned samples')
for r in rows:
 if r['split']!=assigned[r['id']]['split']:raise ValueError('Changed split')
 if not r.get('usable') or r.get('failure') or not r.get('wireContainsExactPrompt') or not r.get('wireContainsExactSystem') or r.get('wireToolCount')!=0 or r.get('wireHistoryEntries')!=0:raise ValueError('Failed measurement or transport integrity')
 if r.get('provider')!='kiro' or r.get('model')!='claude-opus-4-5' or r.get('catalogContextWindowTokens')!=200000:raise ValueError('Unexpected route/window')
 if any(not isinstance(r.get(k),int) or isinstance(r.get(k),bool) or r[k]<0 for k in ['reportedInput','cacheRead','cacheWrite','localTokens']) or r['localTokens']<=0:raise ValueError('Missing/invalid counts')
 if any(not isinstance(r.get(k),str) or not r[k] for k in ['piVersion','providerVersion']):raise ValueError('Missing measured/explicit historical versions')
 observed=sum(r[k] for k in ['reportedInput','cacheRead','cacheWrite']);pct=r.get('percentageDerivedTokensCeil')
 if pct is not None:
  if not isinstance(pct,int) or isinstance(pct,bool) or pct<0:raise ValueError('Invalid percent count')
  observed=max(observed,pct)
 elif r.get('countOrigin')!='metadata_token_usage':raise ValueError('Missing percentage-derived count')
 r['observedInputUpper']=observed
train=[r for r in rows if r['split']=='train'];held=[r for r in rows if r['split']=='heldout']
if len(train)!=30 or len(held)!=19:raise ValueError('Expected30train19heldout')
worst=max(train,key=lambda r:Fraction(r['observedInputUpper'],r['localTokens']));num=math.ceil(Fraction(worst['observedInputUpper']*120,worst['localTokens']));den=100;fixed=512
for r in rows:r['forecastTokens']=math.ceil(Fraction(r['localTokens']*num,den))+fixed;r['forecastCoversObserved']=r['forecastTokens']>=r['observedInputUpper']
if not all(r['forecastCoversObserved'] for r in rows):raise ValueError('Train-selected forecast did not cover every heldout/train sample; no fit published')
summary={'schema':'kiro-cl100k-calibration-fit-v2','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'model':'kiro/claude-opus-4-5','tokenizer':'cl100k_base','selection':'train only; exact rational max(observedInputUpper/localTokens), uplift20%, ceil numerator at denominator100, fixed512 additional','trainCount':len(train),'heldoutCount':len(held),'failureCount':0,'numerator':num,'denominator':den,'fixedTokens':fixed,'maxTrainRatioNumerator':worst['observedInputUpper'],'maxTrainRatioDenominator':worst['localTokens'],'maxTrainRatioSample':worst['id'],'minMeasuredBytes':min(r['exactUtf8Bytes'] for r in rows),'maxMeasuredBytes':max(r['exactUtf8Bytes'] for r in rows),'trainCovered':sum(r['forecastCoversObserved'] for r in train),'heldoutCovered':sum(r['forecastCoversObserved'] for r in held),'manifests':[{'filename':n,'sha256':hashlib.sha256((root/n).read_bytes()).hexdigest()} for n in ['manifest.json','extension_manifest.json','large_extension_manifest.json','incident_manifest.json','all_manifest.json']]}
(root/'fit-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
compact={'schema':'kiro-cl100k-calibration-corpus-v2','providerVersions':fixture['providerVersions'],'piVersions':fixture['piVersions'],'generatedAt':summary['generatedAt'],'summary':summary,'samples':[{k:v for k,v in r.items() if k not in ['path','rawUsageEvents']} for r in rows]}
(root/'corpus-fixture.json').write_text(json.dumps(compact,ensure_ascii=False,indent=2));print(json.dumps(summary,indent=2))
