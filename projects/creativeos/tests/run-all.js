'use strict';
const assert=require('assert'),M=require('../model');
const seeds=M.seeds();assert.deepStrictEqual(M.importWorkspace(M.pack(seeds)),seeds);
assert.strictEqual(M.name('../bad:name/one'),'.. bad name one');
assert.throws(()=>M.importWorkspace('{"format":"creativeOS/1","files":[{"type":"html"}]}'));
assert.throws(()=>M.importWorkspace(JSON.stringify({format:'creativeOS/1',files:[{type:'note',content:3}]})));
assert.throws(()=>M.valid({type:'sketch',strokes:[{color:'#fff000',width:.01,points:[[Infinity,.5]]}]}));
assert.throws(()=>M.valid({type:'palette',colors:['#000000']}));
assert.throws(()=>M.importWorkspace('x'.repeat(2000001)));
for(let h=0;h<360;h++){const p=M.palette(h);assert.strictEqual(p.length,5);assert(p.every(x=>/^#[0-9a-f]{6}$/.test(x)));}
const trash=M.seeds();trash[0].trashed=true;assert(M.importWorkspace(M.pack(trash))[0].trashed);
assert.throws(()=>M.pack(Array.from({length:40},(_,i)=>({id:String(i),type:'note',name:'large',content:'x'.repeat(50000),trashed:false}))),/2 MB/);
assert.throws(()=>M.pack(Array.from({length:20},(_,i)=>({id:String(i),type:'note',name:'large',content:'\u754c'.repeat(50000),trashed:false}))),/2 MB/);
assert.throws(()=>M.pack(Array.from({length:101},(_,i)=>({id:String(i),type:'note',name:'small',content:'',trashed:false}))),/100 files/);
console.log('creativeOS: file/export roundtrips, trash, colours, import rejection, shared UTF-8 size and file-count limits passed');
