(function (root) {

  'use strict';

  var FEATURES = [

    {key:'volume',name:'Shot volume',short:'Volume',unit:'unblocked shots / 60',definition:'Individual unblocked attempts per 60 minutes; team need uses team unblocked attempts per 60.'},

    {key:'quality',name:'Chance quality',short:'Quality',unit:'xG / 100 shots',definition:'Expected goals per 100 unblocked attempts. It describes the chances taken, not finishing skill.'},

    {key:'finishing',name:'Finishing',short:'Finishing',unit:'goals − xG / 60',definition:'Past goals above expected per 60. This is noisy; regularisation pulls it towards the position average.'},

    {key:'suppression',name:'Suppression context',short:'Suppression',unit:'fewer xGA / 60 on ice',definition:'Off-ice minus on-ice expected goals against per 60. Teammates, opponents and deployment remain mixed in; this is not isolated defensive talent.'}

  ];

  var AGE = {0:1,1:0.6,2:0.3};

  function finite(x){return typeof x==='number'&&Number.isFinite(x);}

  function group(row){return row.position==='D'?'D':'F';}

  function raw(rows,endYear,omit){

    var counts={seconds:0,shots:0,xg:0,goals:0,onXga:0,offXga:0,bench:0},used=[];

    rows.forEach(function(r){var age=endYear-r.season,w=AGE[age];if(w===undefined||r.season===omit)return;Object.keys(counts).forEach(function(k){counts[k]+=r[k]*w;});used.push(r.season);});

    if(counts.seconds<=0||counts.shots<=0||counts.bench<=0)return null;

    return {minutes:counts.seconds/60,seasons:used.sort(),values:[counts.shots*3600/counts.seconds,counts.xg*100/counts.shots,(counts.goals-counts.xg)*3600/counts.seconds,counts.offXga*3600/counts.bench-counts.onXga*3600/counts.seconds]};

  }

  function moments(values){var mean=values.reduce(function(a,b){return a+b;},0)/values.length,variance=values.reduce(function(a,b){return a+(b-mean)*(b-mean);},0)/values.length;return {mean:mean,sd:Math.sqrt(variance)||1};}

  function baseline(rows,year){var out={};['F','D'].forEach(function(role){var peers=rows.filter(function(r){return r.season===year&&group(r)===role&&r.seconds>=18000;}),values=peers.map(function(r){return raw([r],year).values;});if(!values.length)throw Error('No position baseline for '+role);out[role]=FEATURES.map(function(_,j){return moments(values.map(function(a){return a[j];}));});});return out;}

  function profile(rows,year,base,priors,omit){var latest=rows.filter(function(r){return r.season<=year;}).sort(function(a,b){return b.season-a.season;})[0];if(!latest)return null;var observed=raw(rows,year,omit);if(!observed)return null;var role=group(latest),norm=base[role];

    var adjusted=observed.values.map(function(x,j){var factor=observed.minutes/(observed.minutes+priors[j]);return norm[j].mean+(x-norm[j].mean)*factor;});

    return {id:latest.id,name:latest.name,team:latest.team,position:latest.position,role:role,minutes:latest.seconds/60,weightedMinutes:observed.minutes,seasons:observed.seasons,raw:observed.values,values:adjusted,z:adjusted.map(function(x,j){return Math.max(-4,Math.min(4,(x-norm[j].mean)/norm[j].sd));}),retained:priors.map(function(p){return observed.minutes/(observed.minutes+p);})};

  }

  function teamValues(t){return [t.shots*3600/t.seconds,t.xg*100/t.shots,(t.goals-t.xg)*3600/t.seconds,-t.xga*3600/t.seconds];}

  function teams(rows){var norms=FEATURES.map(function(_,j){return moments(rows.map(function(t){return teamValues(t)[j];}));});return rows.map(function(t){var values=teamValues(t),z=values.map(function(x,j){return(x-norms[j].mean)/norms[j].sd;});return {id:t.team,name:t.name,values:values,z:z,need:z.map(function(x){return Math.min(3,Math.max(0,-x));})};});}

  function weights(input){if(!Array.isArray(input)||input.length!==4||input.some(function(x){return !finite(x)||x<0;}))throw Error('Use four non-negative priorities');var total=input.reduce(function(a,b){return a+b;},0);if(!total)throw Error('Choose at least one priority');return input.map(function(x){return x/total;});}

  function fit(p,t,input){var w=weights(input),terms=p.z.map(function(z,j){return w[j]*t.need[j]*z;});return {team:t,score:terms.reduce(function(a,b){return a+b;},0),terms:terms,weights:w};}

  function rank(p,teamList,input,includeOwn){if(!p)throw Error('Choose an eligible skater');weights(input);return teamList.filter(function(t){return includeOwn||t.id!==p.team;}).map(function(t){return fit(p,t,input);}).sort(function(a,b){return b.score-a.score||a.team.id.localeCompare(b.team.id);});}

  function percentile(value,values){var less=0,equal=0;values.forEach(function(x){if(x<value)less++;else if(Math.abs(x-value)<1e-10)equal++;});return 100*(less+.5*equal)/values.length;}

  function prepare(data,regularise){var byId={};data.skaters.forEach(function(r){if(!byId[r.id])byId[r.id]=[];byId[r.id].push(r);});var base=baseline(data.skaters,data.season),priors=regularise===false?[0,0,0,0]:data.priors,players=[];

    Object.keys(byId).forEach(function(id){var rows=byId[id],latest=rows.find(function(r){return r.season===data.season;});if(!latest||latest.seconds<18000)return;var p=profile(rows,data.season,base,priors);if(p)players.push(p);});players.sort(function(a,b){return a.name.localeCompare(b.name);});

    var peers={F:[[],[],[],[]],D:[[],[],[],[]]};players.forEach(function(p){p.z.forEach(function(z,j){peers[p.role][j].push(z);});});Object.keys(peers).forEach(function(role){peers[role].forEach(function(a){a.sort(function(a,b){return a-b;});});});

    function sortedPercentile(x,a){var low=0,high=a.length;while(low<high){var mid=(low+high)>>1;if(a[mid]<x)low=mid+1;else high=mid;}var first=low;high=a.length;while(low<high){var next=(low+high)>>1;if(a[next]<=x)low=next+1;else high=next;}return 100*(first+(low-first)/2)/a.length;}

    players.forEach(function(p){p.percentiles=p.z.map(function(z,j){return sortedPercentile(z,peers[p.role][j]);});});var teamList=teams(data.teams);teamList.forEach(function(t){t.needPercentiles=t.z.map(function(z,j){return percentile(-z,teamList.map(function(u){return-u.z[j];}));});});return {players:players,teams:teamList,byId:byId,base:base,priors:priors};

  }

  function sensitivity(p,prepared,data,input,includeOwn){var rows=prepared.byId[p.id],years=p.seasons,leaders=[];if(years.length<2)return {available:false,count:0,same:0};years.forEach(function(y){var q=profile(rows,data.season,prepared.base,prepared.priors,y);if(q){var r=rank(q,prepared.teams,input,includeOwn);if(r.length)leaders.push(r[0].team.id);}});var original=rank(p,prepared.teams,input,includeOwn)[0];return {available:leaders.length>0,count:leaders.length,same:leaders.filter(function(t){return t===original.team.id;}).length,leaders:leaders};}

  // Choose each shrinkage prior on one earlier season transition, never the holdout.

  function validate(rows){var candidates=[0,300,600,1200,2400],trainingYear=2023,holdoutYear=2024,byId={};rows.forEach(function(r){if(!byId[r.id])byId[r.id]=[];byId[r.id].push(r);});

    function errors(year,priors){var base=baseline(rows,year),sums=[0,0,0,0],n=0;Object.keys(byId).forEach(function(id){var rs=byId[id],a=rs.find(function(r){return r.season===year;}),b=rs.find(function(r){return r.season===year+1;});if(!a||!b||a.seconds<18000||b.seconds<36000||group(a)!==group(b))return;var p=profile(rs,year,base,priors),target=raw([b],year+1).values;if(!p)return;n++;target.forEach(function(x,j){var error=(p.values[j]-x)/base[p.role][j].sd;sums[j]+=error*error;});});return {n:n,mse:sums.map(function(s){return s/n;})};}

    var grid=candidates.map(function(p){return {prior:p,result:errors(trainingYear,[p,p,p,p])};}),priors=FEATURES.map(function(_,j){return grid.slice().sort(function(a,b){return a.result.mse[j]-b.result.mse[j]||a.prior-b.prior;})[0].prior;}),rawCheck=errors(holdoutYear,[0,0,0,0]),shrunk=errors(holdoutYear,priors);

    return {priors:priors,tuneTransition:'2023–24 → 2024–25',holdoutTransition:'2024–25 → 2025–26',tuneN:grid[0].result.n,holdoutN:shrunk.n,candidates:candidates,grid:grid.map(function(g){return {prior:g.prior,rmse:g.result.mse.map(Math.sqrt)};}),unshrunkRMSE:Math.sqrt(rawCheck.mse.reduce(function(a,b){return a+b;},0)/4),shrunkRMSE:Math.sqrt(shrunk.mse.reduce(function(a,b){return a+b;},0)/4),perFeatureRaw:rawCheck.mse.map(Math.sqrt),perFeatureShrunk:shrunk.mse.map(Math.sqrt)};

  }

  var api={FEATURES:FEATURES,group:group,raw:raw,baseline:baseline,profile:profile,moments:moments,teams:teams,teamValues:teamValues,weights:weights,fit:fit,rank:rank,percentile:percentile,prepare:prepare,sensitivity:sensitivity,validate:validate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Lineup=api;

})(typeof self!=='undefined'?self:this);

