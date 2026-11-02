// HIDDEN CHECK: every number on the page comes from data/eval.json.
// Static numbers in index.html sit in [data-num] spans whose text equals the formatted JSON value
// (app.js overwrites them from the JSON on load); app.js may not hard-code percentages or decimals.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ev = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'eval.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function get(o, p) { return p.split('.').reduce((a, k) => a == null ? a : a[k], o); }
// must match fmt() in app.js
function fmt(v, how) {
  if (how === 'pct1') return v.toFixed(1) + '%';
  if (how === 'pct2') return v.toFixed(2) + '%';
  if (how === 'frac1') return (v * 100).toFixed(1) + '%';
  if (how === 'int') return Math.round(v).toLocaleString('en-GB');
  return String(v);
}
let spans = 0;
const re = /<span data-num="([^"]+)" data-fmt="([^"]+)">([^<]*)<\/span>/g;
let m;
while ((m = re.exec(html))) {
  spans++;
  const v = get(ev, m[1]);
  assert.strictEqual(typeof v, 'number', m[1] + ' is in eval.json');
  assert.strictEqual(m[3], fmt(v, m[2]), m[1] + ' static text matches the JSON');
}
assert.ok(spans >= 2, 'the lede numbers are bound to the JSON');
// visible page text outside those spans: no digits but the licence name and the example tokens
const body = html.split('<body>')[1]
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(re, '')
  .replace(/<[^>]+>/g, ' ');
const leftovers = body.replace(/CC BY-SA 4\.0/g, '').replace(/£900|3,500 kg|May 20, 2008/g, '');
assert.ok(!/\d/.test(leftovers), 'unexpected digits in page text: ' + leftovers.match(/\S*\d\S*/g));
// app.js strings: no hard-coded percentage or decimal (example sentences aside)
const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const strings = code.match(/'(?:[^'\\\n]|\\.)*'/g) || [];
strings.forEach(s => {
  if (/£900|3,500 kg|May 20, 2008/.test(s)) return;
  assert.ok(!/\d\s*%/.test(s), 'hard-coded percentage in app.js: ' + s);
  assert.ok(!/\d\.\d/.test(s), 'hard-coded decimal in app.js: ' + s);
});
assert.ok(/fetch\(url\)/.test(app) && /data\/eval\.json/.test(app), 'the page loads eval.json');
console.log('test_numbers: ok (%d data-num spans)', spans);
