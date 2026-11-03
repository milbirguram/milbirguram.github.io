'use strict';

const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),M=require('../model');

const c={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../data.js'),'utf8'),c);const data=JSON.parse(JSON.stringify(c.LineupData));

function close(a,b,message){assert(Math.abs(a-b)<1e-10,message||a+' != '+b);}

const row={id:1,name:'Fixture skater',position:'C',team:'OWN',season:2025,seconds:3600,shots:10,xg:1,goals:2,onXga:2,offXga:9,bench:10800};

M.raw([row],2025).values.forEach((x,j)=>close(x,[10,10,1,1][j],'seconds, shot quality and on/off denominators'));

const base={F:[{mean:8,sd:2},{mean:12,sd:2},{mean:0,sd:1},{mean:0,sd:1}],D:[]},p=M.profile([row],2025,base,[60,60,60,60]);p.values.forEach((x,j)=>close(x,[9,11,.5,.5][j]));p.z.forEach((x,j)=>close(x,[.5,-.5,.5,.5][j]));assert.deepStrictEqual(M.profile([row],2025,base,[0,0,0,0]).values,[10,10,1,1]);

const old=Object.assign({},row,{season:2024,shots:20});const pooled=M.raw([old,row],2025);close(pooled.minutes,96);close(pooled.values[0],(10+20*.6)/(1+.6));assert.deepStrictEqual(M.raw([old,row],2025,2024).values,[10,10,1,1]);assert.strictEqual(M.raw([row],2025,2025),null);

const a={id:'A',name:'Team A',need:[2,0,0,0]},b={id:'B',name:'Team B',need:[0,2,0,0]},own={id:'OWN',need:[3,3,3,3]};close(M.fit(p,a,[1,1,1,1]).score,.25);close(M.fit(p,a,[2,2,2,2]).score,.25);assert.strictEqual(M.rank(p,[a,b,own],[1,1,1,1],false).length,2);assert.strictEqual(M.rank(p,[a,b,own],[1,1,1,1],true).length,3);assert.throws(()=>M.rank(p,[a],[0,0,0,0]),/priority/);assert.throws(()=>M.weights([1,NaN,1,1]));assert.throws(()=>M.weights([1,-1,1,1]));

const versatile=Object.assign({},p,{z:[1,1,0,0]});assert.strictEqual(M.rank(versatile,[a,b],[3,1,1,1])[0].team.id,'A');assert.strictEqual(M.rank(versatile,[a,b],[1,3,1,1])[0].team.id,'B');

close(M.percentile(2,[1,2,2,3]),50);assert.strictEqual(M.raw([Object.assign({},row,{seconds:0})],2025),null);

const prepared=M.prepare(data),unshrunk=M.prepare(data,false);assert.strictEqual(prepared.players.length,678);assert.strictEqual(prepared.teams.length,32);assert.strictEqual(new Set(prepared.players.map(p=>p.id)).size,678);assert(prepared.players.some(p=>p.name==='Connor Bedard'));assert(prepared.players.every(p=>p.minutes>=300));assert(prepared.players.every(p=>p.role==='F'||p.role==='D'));

for(const q of prepared.players){assert(q.values.every(Number.isFinite));assert(q.z.every(z=>Number.isFinite(z)&&Math.abs(z)<=4));assert(q.percentiles.every(x=>x>=0&&x<=100));const r=M.rank(q,prepared.teams,[1,1,1,1]);assert.strictEqual(r.length,31);assert(!r.some(r=>r.team.id===q.team));assert(r.every(r=>r.terms.every(Number.isFinite)));for(let i=1;i<r.length;i++)assert(r[i].score<=r[i-1].score+1e-12);for(const result of r)close(result.score,result.terms.reduce((a,b)=>a+b,0));}

for(const t of prepared.teams){assert(t.need.every(n=>n>=0&&n<=3));assert(t.z.every(Number.isFinite));}

const bedard=prepared.players.find(p=>p.name==='Connor Bedard'),r=M.rank(bedard,prepared.teams,[1,1,1,1]);assert.deepStrictEqual(M.rank(bedard,prepared.teams,[1,1,1,1]),r);assert(M.sensitivity(bedard,prepared,data,[1,1,1,1],false).count===3);

assert(unshrunk.players.some(p=>p.values.some((v,j)=>Math.abs(v-prepared.players.find(q=>q.id===p.id).values[j])>.0001)));

const validation=M.validate(data.skaters);assert.deepStrictEqual(validation.priors,data.priors);close(validation.shrunkRMSE,data.validation.shrunkRMSE);assert(validation.holdoutN===492&&validation.tuneN===505);const changed=data.skaters.map(r=>r.season===2025?Object.assign({},r,{goals:r.goals+100}):r);assert.deepStrictEqual(M.validate(changed).priors,validation.priors,'holdout labels cannot tune the prior');

console.log('Lineup: hand-computed rates, weighting, shrinkage and score terms passed');console.log('678 skaters × 31 teams: finite scores, exact decompositions, deterministic ordering and team exclusion passed');console.log('Temporal holdout:',validation.holdoutN,'skaters; RMSE',validation.unshrunkRMSE,'→',validation.shrunkRMSE);console.log('No holdout leakage in prior selection; sensitivity and regularisation controls passed');

