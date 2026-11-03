const assert=require('assert'),M=require('../model.js');let n=0;function test(fn){fn();n++;}
for(const fault of M.FAULTS)for(const policy of ['quick','checklist','adaptive'])for(let budget=0;budget<=10;budget++){const world=M.fixture(fault.id,17,true),seen=[];const r=M.run(t=>{seen.push(t);return M.observe(world,t);},policy,budget);test(()=>assert(r.spent<=budget));test(()=>assert.equal(new Set(seen).size,seen.length));test(()=>assert(r.history.every(o=>o.after.includes(fault.id))));if(r.conclusion.kind==='diagnosis')test(()=>assert.equal(r.conclusion.id,fault.id));}
test(()=>assert.equal(M.summary(M.suite('quick',5)).accuracy,.5));test(()=>assert.equal(M.summary(M.suite('adaptive',5)).accuracy,1));
for(let b=0;b<=10;b++){const fixed=M.summary(M.suite('checklist',b)),adaptive=M.summary(M.suite('adaptive',b));test(()=>assert.equal(fixed.accuracy,adaptive.accuracy));test(()=>assert.equal(fixed.cost,adaptive.cost));}
test(()=>assert.equal(new Set(M.suite('adaptive',5).map(c=>JSON.stringify(c.result.history.map(o=>[o.tool,o.signal])))).size,6));
test(()=>assert.throws(()=>M.run(()=>null,'adaptive',5)));test(()=>assert.throws(()=>M.run(()=>null,'unknown',5)));test(()=>assert.throws(()=>M.run(()=>null,'adaptive',-1)));
const world=M.fixture('pool',1,true),a=M.run(t=>M.observe(world,t),'adaptive',5),b=M.run(t=>{const o=M.observe(world,t);o.detail=['different unused prose'];return o;},'adaptive',5);test(()=>assert.deepStrictEqual(a.history.map(o=>o.after),b.history.map(o=>o.after)));
console.log('Faultline: '+n+' checks passed across all states, policies and budgets.');
