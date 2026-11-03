// Run from any directory. Original renderer; no external rendering package.
const fs=require('fs'),path=require('path'),M=require('../model');
const base=path.join(__dirname,'..'),pixels=M.render(40,25,8192,{bounces:8,materials:[2,0,1],dof:false},20000);
fs.writeFileSync(path.join(base,'reference.js'),'var PrismReference = '+JSON.stringify({width:40,height:25,samples:8192,seedOffset:20000,pixels:Array.from(pixels).map(x=>Number(x.toFixed(7)))})+';\n');
const w=320,h=200,image=M.render(w,h,128,{bounces:8,materials:[2,0,1],dof:false});
const bytes=Buffer.alloc(w*h*3);for(let i=0;i<image.length;i++)bytes[i]=Math.round(255*Math.sqrt(Math.max(0,Math.min(1,image[i]))));fs.writeFileSync(path.join(base,'still.ppm'),Buffer.concat([Buffer.from('P6\n'+w+' '+h+'\n255\n'),bytes]));
console.log('Reference and still generated');
