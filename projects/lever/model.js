/* Finite causal model, exact Bayes updates, and seeded observations. No network or ML API. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LeverModel=factory();})(this,function(){
  'use strict';
  const models=[
    {id:'A',name:'Use changes return',short:'Use → return',effect:.6,joint:[.4,.1,.1,.4]},
    {id:'B',name:'A common cause',short:'Readiness → both',effect:0,joint:[.4,.1,.1,.4]},
    {id:'C',name:'The arrow reverses',short:'Return → use',effect:0,joint:[.4,.1,.1,.4]}
  ];
  const actions=[
    {id:'observe',name:'Watch more users',verb:'Observe',n:64,cost:1,p:[.8,.8,.8],measure:'matched use / return',detail:'Count how often use and return match. All three mechanisms predict 80%.'},
    {id:'use',name:'Set use to yes',verb:'Set use',n:16,cost:3,p:[.8,.5,.5],measure:'returned',detail:'Clamp use to yes for 16 simulated people. Count who returns.'},
    {id:'return',name:'Set return to yes',verb:'Set return',n:16,cost:3,p:[.5,.5,.8],measure:'used the feature',detail:'Clamp return to yes for 16 simulated people. Count who uses the feature.'}
  ];
  function rng(seed){let x=seed>>>0;return function(){x+=0x6D2B79F5;let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
  function entropy(p){return p.reduce((s,v)=>s-(v>0?v*Math.log2(v):0),0);}
  function uncertainty(p,target){return entropy(target==='mechanism'?p:[p[0],p[1]+p[2]]);}
  function binomial(n,k,p){let c=1;for(let j=1;j<=k;j++)c=c*(n-j+1)/j;return c*Math.pow(p,k)*Math.pow(1-p,n-k);}
  function posterior(prior,action,k){if(!Number.isInteger(k)||k<0||k>action.n)throw Error('Invalid observation');const weights=prior.map((v,i)=>v*binomial(action.n,k,action.p[i]));const z=weights.reduce((a,b)=>a+b,0);if(!z)throw Error('Impossible evidence');return weights.map(v=>v/z);}
  function expectedGain(prior,action,target){let after=0;for(let k=0;k<=action.n;k++){const chance=prior.reduce((s,v,i)=>s+v*binomial(action.n,k,action.p[i]),0);if(chance>0)after+=chance*uncertainty(posterior(prior,action,k),target);}return Math.max(0,uncertainty(prior,target)-after);}
  function create(seed){const random=rng(seed);return {seed:seed>>>0,truth:Math.floor(random()*3),prior:[1/3,1/3,1/3],budget:9,history:[],random:random,revealed:false};}
  function perform(state,id,target){const a=actions.find(x=>x.id===id);if(!a)throw Error('Unknown experiment');if(state.revealed)throw Error('This world is revealed');if(a.cost>state.budget)throw Error('Insufficient credits');const before=state.prior.slice();let k=0;for(let i=0;i<a.n;i++)if(state.random()<a.p[state.truth])k++;state.prior=posterior(before,a,k);state.budget-=a.cost;const record={action:id,n:a.n,k:k,cost:a.cost,before:before,after:state.prior.slice(),expectedGain:expectedGain(before,a,target),target:target};state.history.push(record);return record;}
  function recommendation(state,target){return actions.filter(a=>a.cost<=state.budget).map(a=>({action:a,gain:expectedGain(state.prior,a,target)})).sort((a,b)=>b.gain/b.action.cost-a.gain/a.action.cost)[0]||null;}
  function observationalJoint(){return [.4,.1,.1,.4];}
  return {models:models,actions:actions,rng:rng,entropy:entropy,uncertainty:uncertainty,binomial:binomial,posterior:posterior,expectedGain:expectedGain,create:create,perform:perform,recommendation:recommendation,observationalJoint:observationalJoint};
});
