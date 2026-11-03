"""Pin a deliberately bounded, line-addressable source corpus."""
import hashlib, json, pathlib, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[1]
SITE = ROOT.parents[1]
REV = '80d4b9138e970e3409d32f408d379cc71f3dad3d'
PATHS = ['projects/almanac/README.md', 'projects/almanac/pipeline/run.py',
         'projects/almanac/pipeline/contract.py', 'projects/almanac/pipeline/contract.json',
         'projects/almanac/pipeline/almanac.yml', '.github/workflows/almanac.yml',
         'projects/almanac/model.js', 'projects/almanac/tests/test_contract.py',
         'projects/almanac/tests/test_pipeline.py', 'projects/almanac/tests/freshness.test.js']
files, chunks = [], []
for path in PATHS:
    raw = subprocess.check_output(['git', 'show', REV + ':' + path], cwd=SITE)
    lines = raw.decode('utf-8').splitlines()
    files.append(dict(path=path, lines=lines, sha256=hashlib.sha256(raw).hexdigest()))
    for start in range(0, len(lines), 26):
        end = min(start + 36, len(lines))
        chunks.append(dict(id=f'{len(files)-1}:{start+1}', path=path, start=start+1,
                           end=end, text='\n'.join(lines[start:end])))
payload = dict(repo='milbirguram/milbirguram.github.io', revision=REV,
               scope='Ten files from Almanac: pipeline, workflow, model and selected tests. Not the whole repository; no live run data.',
               files=files, chunks=chunks)
(ROOT/'data/corpus.json').write_bytes((json.dumps(payload, ensure_ascii=False, indent=2)+'\n').encode('utf-8'))
(ROOT/'corpus.js').write_bytes(('window.TraceCorpus='+json.dumps(payload, ensure_ascii=False, separators=(',', ':'))+';\n').encode('utf-8'))
print(len(files), 'files;', len(chunks), 'overlapping chunks;', sum(len(f['lines']) for f in files), 'lines')
