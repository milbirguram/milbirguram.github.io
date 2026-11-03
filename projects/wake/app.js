(function(){'use strict';
const $=id=>document.getElementById(id), colours=['#b2684f','#829270','#b79b4f','#6c9490','#7d7c98','#bd927e'];
let options={seed:7,policy:'volume',explore:.05,shared:false},feed,probe,day=Kit.preview?35:1,playing=false,last=0;
$('legend').innerHTML=Wake.names.map((n,i)=>'<span><i style="background:'+colours[i]+'"></i>'+n+'</span>').join('');
function rebuild(){feed=Wake.run({...options,evidence:'feed'});probe=Wake.run({...options,evidence:'probe'});render();}
function canvas(id){const c=$(id),r=c.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);if(r.width<1||r.height<1)return null;c.width=Math.round(r.width*d);c.height=Math.round(r.height*d);const x=c.getContext('2d');x.scale(d,d);return {x,w:r.width,h:r.height};}
function field(){const z=canvas('field');if(!z||!feed)return;const {x,w,h}=z; x.clearRect(0,0,w,h);const preview=Kit.preview;
const radius=Math.min(w*.19,h*.39), cy=h*.50, centres=[w*.25,w*.75];
[feed,probe].forEach((run,side)=>{const cx=centres[side],snap=run.history[day-1];
x.strokeStyle='#c9c2ad';x.lineWidth=.7;for(let rr of [.43,.73,1]){x.beginPath();x.arc(cx,cy,radius*rr,0,Math.PI*2);x.stroke();}
for(let u=0;u<Wake.N;u++){const a=u/Wake.N*Math.PI*2-Math.PI/2,p=run.people[u],k=snap.chosen[u];const innerA=p.favourite/6*Math.PI*2-Math.PI/2+(u%20-10)*.025;
const ix=cx+Math.cos(innerA)*radius*.43,iy=cy+Math.sin(innerA)*radius*.43;
const outerA=k/6*Math.PI*2-Math.PI/2+((u*0.618)%1-.5)*.78;
const ox=cx+Math.cos(outerA)*radius*(.77+.23*Wake.rnd(options.seed,u,0,90)),oy=cy+Math.sin(outerA)*radius*(.77+.23*Wake.rnd(options.seed,u,0,90));
x.beginPath();x.moveTo(ix,iy);x.quadraticCurveTo(cx+Math.cos(a)*radius*.65,cy+Math.sin(a)*radius*.65,ox,oy);x.strokeStyle=colours[k]+'42';x.stroke();
x.beginPath();x.arc(ix,iy,preview?1.2:1.6,0,Math.PI*2);x.fillStyle=colours[p.favourite];x.fill();
x.beginPath();x.arc(ox,oy,preview?1.8:2.5,0,Math.PI*2);x.fillStyle=colours[k];x.fill();}
x.fillStyle='#504d3b';x.textAlign='center';x.font=(preview?12:14)+'px Georgia';x.fillText(side?'II':'I',cx,cy+5);
if(preview){x.font='10px Georgia';x.fillText(side?'random probes':'own feed',cx,h-15);}
});
x.strokeStyle='#b8b29f';x.setLineDash([2,5]);x.beginPath();x.moveTo(w/2,h*.2);x.lineTo(w/2,h*.8);x.stroke();x.setLineDash([]);
}
function history(){const z=canvas('history');if(!z||!feed)return;const {x,w,h}=z;const left=32,right=w-7,top=9,bottom=h-15;
x.strokeStyle='#c9c2ad';x.lineWidth=.5;x.font='10px sans-serif';x.fillStyle='#6c6a58';x.textAlign='left';[.2,.5,.8].forEach(v=>{const y=bottom-v*(bottom-top);x.beginPath();x.moveTo(left,y);x.lineTo(right,y);x.stroke();x.fillText(Math.round(v*100)+'%',0,y+3);});
[feed,probe].forEach((r,i)=>{x.beginPath();r.history.forEach((s,n)=>{const px=left+n/59*(right-left),py=bottom-s.utility*(bottom-top);n?x.lineTo(px,py):x.moveTo(px,py);});x.strokeStyle=i?'#526d52':'#b45f43';x.lineWidth=1.8;x.setLineDash(i?[4,3]:[]);x.stroke();});x.setLineDash([]);x.strokeStyle='#504d3b';x.lineWidth=.8;const xx=left+(day-1)/59*(right-left);x.beginPath();x.moveTo(xx,top);x.lineTo(xx,bottom);x.stroke();}
function render(){if(!feed)return;const a=feed.history[day-1],b=probe.history[day-1];$('day').value=day;$('day-out').textContent=day;$('day-label').textContent='day '+day;
['feed','probe'].forEach((name,i)=>{const s=i?b:a;$(name+'-utility').textContent=(100*s.utility).toFixed(1)+'%';$(name+'-breadth').textContent=s.breadth.toFixed(1)+' effective categories of 6';});
const delta=(a.utility-b.utility)*100, fav=options.shared?'Most people share a favourite.':'The six favourite groups are equally sized.';
$('observation').textContent=fav+' On day '+day+', learning from its own feed gives '+Math.abs(delta).toFixed(1)+' percentage points '+(delta>=0?'higher':'lower')+' expected click chance than learning from random probes. Change the ranking to test whether that difference survives.';
$('play').textContent=playing?'Pause':'Play 60 days';field();history();}
$('policy').onchange=e=>{options.policy=e.target.value;rebuild();};$('population').onchange=e=>{options.shared=e.target.value==='shared';rebuild();};$('explore').oninput=e=>{options.explore=Number(e.target.value)/100;$('explore-out').textContent=e.target.value+'%';rebuild();};$('seed').onclick=()=>{options.seed++;rebuild();};$('day').oninput=e=>{day=+e.target.value;playing=false;render();};$('reset').onclick=()=>{day=1;playing=false;render();};$('play').onclick=()=>{if(day===60)day=1;playing=!playing;last=0;render();};
function frame(t){if(Kit.playing&&(Kit.preview||playing)&&(!Kit.reducedMotion||!Kit.preview)){if(t-last>(Kit.preview?140:240)){last=t;if(day<60)day++;else if(Kit.preview)day=1;else playing=false;render();}}requestAnimationFrame(frame);}
new ResizeObserver(()=>{field();history();}).observe($('field'));rebuild();requestAnimationFrame(frame);
})();
