/* A discrete-time stream. Each record is valid and delivered exactly once.
   Processing-time watermark is deliberately heuristic: now minus lag. */
(function(root){'use strict';
const WINDOWS=12,SIZE=10;
function rnd(seed,n,tag){let h=(seed^Math.imul(n+7,374761393)^Math.imul(tag+13,668265263))>>>0;h=Math.imul(h^h>>>13,1274126177);return ((h^h>>>16)>>>0)/4294967296;}
function events(seed=11,outage=true){return Array.from({length:240},(_,i)=>{
  const time=i*.5+.1+rnd(seed,i,0)*.3,source=i%3;
  const ordinary=1+Math.floor(rnd(seed,i,1)*4),delay=outage&&source===2&&time>=30&&time<60?28+Math.floor(rnd(seed,i,2)*12):ordinary;
  return {id:i,time,arrival:Math.ceil(time+delay),source,window:Math.floor(time/SIZE)};
}).sort((a,b)=>a.arrival-b.arrival||a.id-b.id);}
function run(options={}){
 const o=Object.assign({seed:11,outage:true,lag:4,lateness:0,early:0},options);
 for(const k of ['lag','lateness','early'])if(!Number.isInteger(o[k])||o[k]<0)throw Error('Invalid '+k);
 const data=events(o.seed,o.outage),truth=Array(WINDOWS).fill(0);data.forEach(e=>truth[e.window]++);
 const windows=Array.from({length:WINDOWS},(_,i)=>({id:i,start:i*SIZE,end:(i+1)*SIZE,count:0,published:null,first:null,last:null,revisions:0,missed:0,firstAfterEnd:null}));
 const end=Math.ceil(Math.max(data[data.length-1].arrival,WINDOWS*SIZE+o.lag+o.lateness)+2),history=[];let at=0,totalDropped=0,stateSeconds=0;
 function publish(w,t){if(w.published===null){w.first=t;}else if(w.published!==w.count)w.revisions++;w.published=w.count;w.last=t;if(t>=w.end&&w.firstAfterEnd===null)w.firstAfterEnd=t;}
 for(let t=0;t<=end;t++){
   const arrived=[],dropped=[];
   while(at<data.length&&data[at].arrival<=t){const e=data[at++],w=windows[e.window];
     if(t>w.end+o.lag+o.lateness){w.missed++;totalDropped++;dropped.push(e.id);}
     else {w.count++;arrived.push(e.id);if(t>=w.end+o.lag&&w.published!==null)publish(w,t);}
   }
   let active=0;
   for(const w of windows){
     if(t===w.end+o.lag)publish(w,t);
     else if(o.early&&t%o.early===0&&t<w.end+o.lag&&w.count>0)publish(w,t);
     if(w.count>0&&t<=w.end+o.lag+o.lateness)active++;
   }
   stateSeconds+=active;
   history.push({t,watermark:t-o.lag,arrived,dropped,totalDropped,active,stateSeconds,windows:windows.map(w=>({...w,status:t>w.end+o.lag+o.lateness?'retired':t>=w.end+o.lag?'late':w.published!==null?'provisional':'open'}))});
 }
 const revisions=windows.reduce((s,w)=>s+w.revisions,0), maxActive=Math.max(...history.map(x=>x.active));
 const firstDelay=windows.reduce((s,w)=>s+w.first-w.end,0)/WINDOWS;
 return {options:o,data,truth,history,end,summary:{dropped:totalDropped,error:windows.reduce((s,w,i)=>s+Math.abs(w.published-truth[i]),0),revisions,maxActive,stateSeconds,firstDelay,completionDelay:o.lag}};
}
const api={WINDOWS,SIZE,rnd,events,run};if(typeof module!=='undefined')module.exports=api;else root.Waterline=api;
})(typeof window!=='undefined'?window:globalThis);
