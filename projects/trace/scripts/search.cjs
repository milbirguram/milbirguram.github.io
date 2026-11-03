const fs=require('fs'),path=require('path'),M=require('../model.js');
const corpus=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/corpus.json'),'utf8'));
const q=process.argv.slice(2).join(' ');
console.log(JSON.stringify(M.search(M.index(corpus.chunks),q,5).map(r=>({id:r.chunk.id,path:r.chunk.path,start:r.chunk.start,end:r.chunk.end,score:r.score,text:r.chunk.text})),null,2));
