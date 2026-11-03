(function(root){'use strict';

function name(value){return String(value||'Untitled').replace(/[\\/:*?"<>|\x00-\x1f]/g,' ').trim().slice(0,60)||'Untitled';}

function valid(file){if(!file||typeof file!=='object'||!['note','sketch','palette'].includes(file.type))throw Error('Unknown file type');var out={id:String(file.id||'').slice(0,80),name:name(file.name),type:file.type,trashed:!!file.trashed};

if(file.type==='note'){if(typeof file.content!=='string'||file.content.length>50000)throw Error('Note is too large');out.content=file.content;}

if(file.type==='palette'){if(!Array.isArray(file.colors)||file.colors.length!==5||file.colors.some(function(c){return !/^#[0-9a-f]{6}$/i.test(c);}))throw Error('Use five hexadecimal colours');out.colors=file.colors.slice();}

if(file.type==='sketch'){if(!Array.isArray(file.strokes)||file.strokes.length>500)throw Error('Sketch has too many strokes');out.strokes=file.strokes.map(function(s){if(!s||!/^#[0-9a-f]{6}$/i.test(s.color)||!Number.isFinite(s.width)||s.width<.001||s.width>.1||!Array.isArray(s.points)||s.points.length>3000)throw Error('Invalid brush stroke');return {color:s.color,width:s.width,points:s.points.map(function(p){if(!Array.isArray(p)||p.length!==2||p.some(function(x){return !Number.isFinite(x)||x<0||x>1;}))throw Error('Invalid sketch point');return p.slice();})};});}return out;}

function bytes(text){return typeof TextEncoder==='function'?new TextEncoder().encode(text).length:unescape(encodeURIComponent(text)).length;}

function importWorkspace(text){if(bytes(text)>2000000)throw Error('Workspace is too large');var data=JSON.parse(text);if(data.format!=='creativeOS/1'||!Array.isArray(data.files)||data.files.length>100)throw Error('This is not a creativeOS workspace');return data.files.map(valid);}

function pack(files){if(files.length>100)throw Error('Workspace limit: 100 files including trash');var text=JSON.stringify({format:'creativeOS/1',files:files.map(valid)},null,2);if(bytes(text)>2000000)throw Error('Workspace limit: 2 MB. Export files or empty trash to make room.');return text;}

function palette(hue){return [0,27,165,205,320].map(function(offset,i){var h=((hue+offset)%360)/60,s=i===4?.3:.6,l=i===4?.92:(i===0?.25:.6),c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h%2-1)),m=l-c/2,rgb=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];return '#'+rgb.map(function(v){return Math.round((v+m)*255).toString(16).padStart(2,'0');}).join('');});}

function seeds(){return[{id:'seed-note',type:'note',name:'Small things worth making',content:'A poster for a place that does not exist.\n\nA melody from the shape of a skyline.\n\nA garden that keeps its own pace.',trashed:false},{id:'seed-palette',type:'palette',name:'After the rain',colors:['#243a52','#afbdaf','#e4ac8b','#c55665','#f6ebd9'],trashed:false},{id:'seed-sketch',type:'sketch',name:'A line of thought',strokes:[{color:'#c55665',width:.012,points:[[.1,.65],[.16,.42],[.24,.35],[.31,.58],[.42,.63],[.5,.23],[.58,.25],[.68,.57],[.8,.48],[.9,.3]]},{color:'#243a52',width:.006,points:[[.1,.73],[.25,.7],[.42,.75],[.58,.68],[.78,.7],[.9,.65]]}],trashed:false}];}

var api={name:name,valid:valid,importWorkspace:importWorkspace,pack:pack,palette:palette,seeds:seeds};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CreativeOS=api;

})(typeof self!=='undefined'?self:this);

