"""Compile the fixed public dataset and real recorded planning batches.
Pass the research directory containing penguins.csv, questions.json and three batch files.
"""
import csv,datetime,hashlib,json,math,re,sqlite3,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];SOURCE=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'data';rows=[]
for i,row in enumerate(csv.DictReader((SOURCE/'penguins.csv').open(encoding='utf-8'))):
 values=[i+1]+[None if row[k]=='NA' else row[k] for k in row]
 for j in [3,4,5,6]:values[j]=float(values[j]) if values[j] is not None else None
 values[8]=int(values[8]);rows.append(values)
columns=['id','species','island','bill_length_mm','bill_depth_mm','flipper_length_mm','body_mass_g','sex','year']
db=sqlite3.connect(':memory:');db.execute('CREATE TABLE penguins(id INTEGER PRIMARY KEY,species TEXT,island TEXT,bill_length_mm REAL,bill_depth_mm REAL,flipper_length_mm REAL,body_mass_g REAL,sex TEXT,year INTEGER)');db.executemany('INSERT INTO penguins VALUES(?,?,?,?,?,?,?,?,?)',rows);db.execute('PRAGMA query_only=ON')
gold=[
'SELECT COUNT(*) FROM penguins',
'SELECT species,COUNT(*) FROM penguins GROUP BY species ORDER BY species',
'SELECT species,AVG(body_mass_g) FROM penguins GROUP BY species ORDER BY species',
'SELECT species,AVG(body_mass_g)/1000.0 FROM penguins GROUP BY species ORDER BY species',
'SELECT COUNT(*) FROM penguins WHERE body_mass_g IS NULL',
'SELECT COUNT(*) FROM penguins WHERE sex IS NULL',
"SELECT COUNT(*) FROM penguins WHERE species='Adelie' AND sex='female'",
'SELECT island,COUNT(*) FROM penguins GROUP BY island ORDER BY island',
'SELECT species,AVG(body_mass_g) FROM penguins GROUP BY species ORDER BY AVG(body_mass_g) DESC LIMIT 1',
'SELECT species,MIN(flipper_length_mm),MAX(flipper_length_mm) FROM penguins GROUP BY species ORDER BY species',
'SELECT COUNT(*) FROM penguins WHERE bill_length_mm IS NOT NULL AND bill_depth_mm IS NOT NULL AND flipper_length_mm IS NOT NULL AND body_mass_g IS NOT NULL AND sex IS NOT NULL',
"SELECT 100.0*SUM(CASE WHEN species='Gentoo' THEN 1 ELSE 0 END)/COUNT(*) FROM penguins",
"SELECT sex,AVG(body_mass_g) FROM penguins WHERE species='Adelie' AND sex IS NOT NULL GROUP BY sex ORDER BY sex",
'SELECT year,COUNT(*) FROM penguins GROUP BY year ORDER BY year',
'SELECT island,AVG(body_mass_g) FROM penguins GROUP BY island ORDER BY AVG(body_mass_g) DESC LIMIT 1',None,None,None,
'SELECT AVG(body_mass_g) FROM penguins',
'SELECT species,body_mass_g FROM penguins WHERE body_mass_g IS NOT NULL ORDER BY body_mass_g DESC LIMIT 3']
questions=json.loads((SOURCE/'questions.json').read_text(encoding='utf-8'));cases=[]
for q,sql in zip(questions,gold):
 cases.append(dict(**q,goldSQL=sql,expected=[list(r) for r in db.execute(sql)] if sql else None,ordered=q['id']=='q20',kind='sql' if sql else 'abstain'))
def same(actual,expected,ordered):
 if len(actual)!=len(expected):return False
 a=actual if ordered else sorted(actual,key=lambda r:repr(r));b=expected if ordered else sorted(expected,key=lambda r:repr(r))
 if any(len(x)!=len(y) for x,y in zip(a,b)):return False
 return all((x==y if isinstance(y,int) else abs(x-y)<=max(.01,abs(y)*.001) if isinstance(x,(float,int)) and isinstance(y,float) else x==y) for ar,br in zip(a,b) for x,y in zip(ar,br))
batches=[];manifest=[]
for name in ['bare','guided','verified']:
 capture=SOURCE/(name+'.json')
 if capture.exists():
  raw=capture.read_bytes();batch=json.loads(raw.decode('utf-8'));batch['captureArtifactSHA256']=hashlib.sha256(raw).hexdigest()
 else:
  batch=next(b for b in json.loads((SOURCE/'recorded-batches.json').read_text(encoding='utf-8')) if b['condition']==name)
 manifest.append({'condition':name,'rawArtifactSHA256':batch['captureArtifactSHA256']})
 assert sorted(r['id'] for r in batch['rows'])==sorted(c['id'] for c in cases), 'Each fixed question must appear exactly once'
 # Preserve model outputs while redacting local machine paths from published prompts.
 for key in ['promptText','promptSummary']:
  if key in batch:batch[key]=batch[key].replace(str(SOURCE),'[research]').replace(str(SOURCE).replace('\\','/'),'[research]')
 for output in batch['rows']:
  case=next(c for c in cases if c['id']==output['id']);start=time.perf_counter();actual=None;error=None
  try:actual=[list(r) for r in db.execute(output['sql'])] if output['kind']=='sql' else None
  except sqlite3.Error as e:error=str(e)
  output['gradingSQLMs']=(time.perf_counter()-start)*1000;output['actual']=actual;output['error']=error;output['correct']=output['kind']==case['kind'] and (case['kind']=='abstain' or (error is None and same(actual,case['expected'],case['ordered'])))
 batch['score']=sum(r['correct'] for r in batch['rows']);batches.append(batch)
source={'dataset':'Palmer penguins','source':'https://github.com/allisonhorst/palmerpenguins/blob/8957207b78d6ccd1b4654a9dd9c9041b657478ab/inst/extdata/penguins.csv','licence':'CC0','citation':'Horst, Hill and Gorman (2020); observations collected by Gorman and Palmer Station LTER, 2007–2009.','csvSHA256':hashlib.sha256((SOURCE/'penguins.csv').read_bytes()).hexdigest(),'questionSHA256':hashlib.sha256((SOURCE/'questions.json').read_bytes()).hexdigest(),'builtAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'grading':'Compare result rows; aliases ignored; order only where requested. Counts are exact; other numeric tolerance max(0.01, 0.1% of expected). Abstention required for causal, global-population and future questions.','limits':'One small fixed test set and one inherited Codex model, not a model ranking. Batches ran concurrently. Batch duration includes scheduling and tool/file I/O; tokens, API model latency and billed cost were not recorded.','artifacts':manifest}
payload={'columns':columns,'rows':rows,'cases':cases,'batches':batches,'provenance':source}
(ROOT/'data.js').write_text('var QueryData = '+json.dumps(payload,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
(ROOT/'data'/'provenance.json').write_text(json.dumps(source,indent=2)+'\n',encoding='utf-8')
(ROOT/'data'/'recorded-batches.json').write_text(json.dumps(batches,indent=2)+'\n',encoding='utf-8')
print('Fixed dataset:',len(rows),'rows. Recorded scores:',[(b['condition'],b['score'],len(b['rows'])) for b in batches])
