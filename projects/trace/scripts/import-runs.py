"""Publish genuine captured answers, checking addressability and retrieval reproducibility."""
import hashlib,json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
raw=pathlib.Path(sys.argv[1]).read_bytes(); data=json.loads(raw.decode('utf-8'))
corpus=json.loads((ROOT/'data/corpus.json').read_text(encoding='utf-8'))
for row in data['rows']:
    for s in row['searches']:
        actual=json.loads(subprocess.check_output(['node',str(ROOT/'scripts/search.cjs'),s['query']],cwd=ROOT))
        assert [c['id'] for c in actual]==s['resultIds'], (row['id'],s['query'])
    for s in row['segments']:
        f=next(f for f in corpus['files'] if f['path']==s['path'])
        assert 1<=s['start']<=s['end']<=len(f['lines'])
        assert s['end']-s['start']<24
for local,label in [(ROOT.parents[1],'[site]'),(pathlib.Path(sys.argv[1]).resolve().parent,'[research]')]:
    data['promptText']=data['promptText'].replace(str(local),label).replace(str(local).replace('\\','/'),label)
data['provenance']={'rawArtifactSHA256':hashlib.sha256(raw).hexdigest(),'revision':corpus['revision'],'retrieval':'BM25, k1=1.2, b=0.75; 36-line chunks with 10-line overlap; top five results. Lexical retrieval, no embeddings.','capture':'Actual model-session outputs and search calls. Citation ranges and search reproducibility checked during import; claims also reviewed against cited source. Not a general code-answering evaluation.','limits':'Five answers, two abstentions, one pinned subset. No fresh model call, production access or automatic updates. API latency, tokens and billed cost were not measured.'}
(ROOT/'data/recorded-runs.json').write_bytes((json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
(ROOT/'runs.js').write_bytes(('window.TraceRuns='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n').encode('utf-8'))
print('Imported',len(data['rows']),'actual captured runs; citations and searches checked.')
