"""Copy exact evaluated artifacts; fail checks if upstream inputs drift."""
import hashlib,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parent
model=(ROOT.parent/'faultline/model.js').read_bytes()
(ROOT/'faultline-core.js').write_bytes(model)
data=json.loads((ROOT.parent/'query/data.js').read_text(encoding='utf-8')[len('var QueryData = '):].strip().removesuffix(';'))
data.pop('rows');data.pop('columns')
(ROOT/'data/sql-runs.js').write_bytes(('window.SQLTrialData='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n').encode('utf-8'))
sources={'faultlineCoreSHA256':hashlib.sha256(model).hexdigest(),'sqlCaptureSourceSHA256':hashlib.sha256((ROOT.parent/'query/data/recorded-batches.json').read_bytes()).hexdigest(),'suites':'36 synthetic fixtures = six fault types × six numeric-detail seeds. Six distinct categorical decision problems; not 36 independent fault mechanisms.','policies':{'quick':'metrics then heuristic guess','checklist':'logs, pool, queue, probe, diff, cache, metrics; stop at singleton','adaptive':'greatest expected candidate elimination per abstract tool cost; equal priors; stop at singleton'},'cost':'Abstract tool units, not tokens, money or API calls. Local JS CPU duration includes simulation observations and policy logic; no model latency measured.'}
(ROOT/'data/provenance.json').write_bytes((json.dumps(sources,indent=2)+'\n').encode('utf-8'))
print('Synced exact Faultline engine and captured SQL artifacts.')
