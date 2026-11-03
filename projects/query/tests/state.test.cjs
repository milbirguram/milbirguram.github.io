// Exercise the actual controller with delayed worker messages, including edits during startup.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
class Node{constructor(tag){this.tag=tag;this.children=[];this.style={};this.value='';this.disabled=false;this._text='';}set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent||'').join('');}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this._text='';this.children=nodes;}setAttribute(k,v){this[k]=v;}click(){if(this.onclick)return this.onclick();}}
const nodes={},workers=[],timers=new Map();let timer=0;const document={getElementById(id){return nodes[id]||(nodes[id]=new Node(id));},createElement(tag){return new Node(tag);}};
document.getElementById('condition').value='guided';
class Worker{constructor(){this.sent=[];this.terminated=false;workers.push(this);}postMessage(m){this.sent.push(m);}terminate(){this.terminated=true;}emit(m){this.onmessage({data:m});}}
const scope={window:{matchMedia(){return {matches:false};}},document,Worker,Kit:{preview:false},URLSearchParams,location:{search:''},setTimeout(fn){timers.set(++timer,fn);return timer;},clearTimeout(id){timers.delete(id);},Map,Error};vm.createContext(scope);
for(const file of ['model.js','data.js','app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../'+file),'utf8'),scope);
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function edit(sql){nodes.sql.value=sql;nodes.sql.oninput();}
function result(worker,value){const m=worker.sent[worker.sent.length-1];worker.emit({type:'result',id:m.id,columns:['value'],values:[[value]],elapsedMs:1});}
(async()=>{
 // Cancel before WASM is ready. A stale ready message must not submit the old plan.
 edit('SELECT 999');assert(workers[0].terminated);workers[0].emit({type:'ready'});await flush();assert.equal(workers[0].sent.length,0);assert(!nodes.run.disabled);assert(nodes['sql-status'].textContent.includes('Edited'));
 let p=nodes.run.onclick(),w=workers[1];w.emit({type:'ready'});await flush();assert.equal(w.sent[0].sql,'SELECT 999');result(w,999);await p;assert(nodes['result-table'].textContent.includes('999'));assert(nodes['agent-trace'].textContent.includes('differ from the fixed expected'));
 // Cancel after submission. A late response cannot put an old result beside changed SQL.
 p=nodes.run.onclick();await flush();edit('SELECT 777');result(w,999);await p;assert(w.terminated);assert.equal(nodes['result-table'].textContent,'');assert(nodes['sql-status'].textContent.includes('Edited'));assert(!nodes.run.disabled);
 // Restore also invalidates an in-flight execution.
 p=nodes.run.onclick();w=workers[2];w.emit({type:'ready'});await flush();nodes.restore.onclick();result(w,777);await p;assert(!nodes.sql.value.includes('777'));assert.equal(nodes['result-table'].textContent,'');assert(!nodes.run.disabled);
 // A local abstention stays a refusal of the claim, while user SQL is truthfully logged.
 nodes['local-mode'].onclick();nodes.ask.value='Did Biscoe cause these penguins to be heavier?';nodes['ask-form'].onsubmit({preventDefault(){}});edit('SELECT COUNT(*) FROM penguins');p=nodes.run.onclick();w=workers[workers.length-1];w.emit({type:'ready'});await flush();result(w,344);await p;assert(nodes['agent-trace'].textContent.includes('Live SQLite returned 1 row'));assert(!nodes['agent-trace'].textContent.includes('No tool call'));assert(nodes['agent-trace'].textContent.includes('abstention still applies'));
 console.log('Query controller: startup cancellation, late-response edits, restore and post-abstention execution passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
