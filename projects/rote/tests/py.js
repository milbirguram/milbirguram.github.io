// Helper: run a Python snippet with the pipeline modules importable; JSON in on stdin, JSON out on stdout.
const { spawnSync } = require('child_process');
const path = require('path');
const PIPE = path.join(__dirname, '..', 'pipeline');
module.exports = function py(code, input) {
  const pre = 'import sys, json\nsys.path.insert(0, ' + JSON.stringify(PIPE) + ')\n' +
    'sys.stdin.reconfigure(encoding="utf-8")\nsys.stdout.reconfigure(encoding="utf-8")\n' +
    'data = json.loads(sys.stdin.read())\n';
  const r = spawnSync(process.env.PYTHON || 'python', ['-I', '-B', '-c', pre + code],
    { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error('python failed: ' + (r.stderr || r.error));
  return JSON.parse(r.stdout);
};
