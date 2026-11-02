// Development aid (not part of run_all): compare the JS rules with the Python dump that
// pipeline/dev_rules.py writes for the whole dev split.  Usage: node tests/dev_agree.js <dev_rules_dump.json>
const fs = require('fs');
const R = require('../model.js');
const dump = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let n = 0, bad = 0;
for (const s of dump) {
  R.runRules(s.t).forEach((r, i) => {
    n++;
    if (r.out !== s.o[i]) { bad++; if (bad < 30) console.log(JSON.stringify(s.t[i]), '| py:', s.o[i], '| js:', r.out); }
  });
}
console.log('tokens', n, 'disagreements', bad);
process.exit(bad ? 1 : 0);
