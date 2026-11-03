/* Wake: decisions generate observations, and observations change decisions.
   All random draws are keyed by seed/day/person/purpose, so paired worlds share noise. */
(function (root) {
  'use strict';
  const K = 6, N = 120, DAYS = 60;
  const names = ['Film', 'Music', 'Science', 'Travel', 'Sport', 'Art'];
  function rnd(seed, a, b, c) {
    let h = (seed ^ Math.imul(a + 11, 374761393) ^ Math.imul(b + 23, 668265263) ^ Math.imul(c + 37, 1274126177)) >>> 0;
    h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  function population(seed, shared) {
    return Array.from({length:N}, (_,u) => {
      const favourite = shared && rnd(seed,u,0,1)<0.8 ? 0 : u%K;
      const p = Array.from({length:K}, (_,k) => 0.10 + 0.04*rnd(seed,u,k,2) + (k===favourite ? .64 : (k===(favourite+1)%K ? .20 : 0)));
      return {favourite,p};
    });
  }
  function entropy(counts) {
    const n=counts.reduce((a,b)=>a+b,0); if(!n) return 0;
    return Math.exp(-counts.reduce((s,c)=>c?s+c/n*Math.log(c/n):s,0));
  }
  function run(options={}) {
    const o=Object.assign({seed:7,policy:'volume',explore:0.05,shared:false,evidence:'feed',days:DAYS},options);
    if(!['volume','rate','personal'].includes(o.policy)) throw Error('Unknown ranking');
    if(!['feed','probe'].includes(o.evidence)) throw Error('Unknown evidence');
    if(o.explore<0||o.explore>1) throw Error('Exploration must be a proportion');
    const people=population(o.seed,o.shared);
    const views=Array.from({length:N},()=>Array(K).fill(0)), clicks=Array.from({length:N},()=>Array(K).fill(0));
    const gv=Array(K).fill(0),gc=Array(K).fill(0), history=[];
    function observe(u,k,v){views[u][k]++;clicks[u][k]+=v;gv[k]++;gc[k]+=v;}
    // Three initial observations per person. Initial visibility is uneven; tastes are not inferred from it.
    for(let u=0;u<N;u++) for(let j=0;j<3;j++){
      const z=rnd(o.seed,u,j,3), k=z<.35?0:1+Math.min(4,Math.floor((z-.35)/.65*5));
      observe(u,k,+(rnd(o.seed,u,j,4)<people[u].p[k]));
    }
    for(let day=1;day<=o.days;day++){
      const chosen=[],count=Array(K).fill(0),actual=Array(K).fill(0), pending=[];
      let utility=0, reward=0;
      for(let u=0;u<N;u++){
        let k;
        if(rnd(o.seed,day,u,10)<o.explore) k=Math.floor(rnd(o.seed,day,u,11)*K);
        else {
          const scores=Array.from({length:K},(_,j)=>o.policy==='volume'?gc[j]:o.policy==='rate'?(gc[j]+1)/(gv[j]+4):(clicks[u][j]+1)/(views[u][j]+4));
          const max=Math.max(...scores), ties=scores.map((v,j)=>v===max?j:-1).filter(j=>j>=0);
          k=ties[Math.floor(rnd(o.seed,day,u,12)*ties.length)];
        }
        const click=+(rnd(o.seed,day,u,13)<people[u].p[k]);
        chosen.push(k);count[k]++;actual[k]+=click;utility+=people[u].p[k];reward+=click;
        const trainK=o.evidence==='feed'?k:Math.floor(rnd(o.seed,day,u,14)*K);
        const trainClick=o.evidence==='feed'?click:+(rnd(o.seed,day,u,15)<people[u].p[trainK]);
        pending.push([u,trainK,trainClick]);
      }
      // Everyone is recommended from yesterday's model; only then is today's evidence fitted.
      pending.forEach(x=>observe(...x));
      history.push({day,chosen,count,actual,utility:utility/N,clickRate:reward/N,breadth:entropy(count),trainingClicks:gc.slice(),trainingViews:gv.slice()});
    }
    return {options:o,people,history};
  }
  function summary(run,last=10){const h=run.history.slice(-last);return {utility:h.reduce((s,x)=>s+x.utility,0)/h.length,breadth:h.reduce((s,x)=>s+x.breadth,0)/h.length};}
  const api={K,N,DAYS,names,rnd,population,entropy,run,summary};
  if(typeof module!=='undefined')module.exports=api;else root.Wake=api;
})(typeof window!=='undefined'?window:globalThis);
