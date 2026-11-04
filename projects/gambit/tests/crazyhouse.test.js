'use strict';
const assert=require('node:assert/strict'),M=require('../model');
let checks=0;
function test(name,fn){fn();checks++;console.log('Crazyhouse:',name);}
function move(g,text){const m=g.parse(text);assert(m,'Legal move: '+text);g.make(m);return m;}
test('reserve move counts and pawn ranks',()=>{
 const n=new M.Game('7k/8/8/8/8/8/8/K7[N] w - - 0 1');assert.equal(n.moves().length,65);
 const p=new M.Game('7k/8/8/8/8/8/8/K7[P] w - - 0 1');assert.equal(p.moves().length,51);
 assert(!p.parse('P@a1'));assert(!p.parse('P@e8'));assert(p.parse('@e4'));assert(!p.parse('P@h8'));
});
test('capture, drop and undo restore every part of the position',()=>{
 const g=new M.Game(M.CRAZY_START),start=g.fen(),key=g.key();
 ['e4','d5','exd5','Qxd5'].forEach(s=>move(g,s));assert.equal(g.pockets.w.p,1);assert.equal(g.pockets.b.p,1);
 const before=g.fen(),keys=g.keys.slice();move(g,'P@e4');assert.equal(g.pockets.w.p,0);assert.equal(g.b[M.index('e4')],'P');
 g.undo();assert.equal(g.fen(),before);assert.deepEqual(g.keys,keys);while(g.undo()){}assert.equal(g.fen(),start);assert.equal(g.key(),key);
});
test('drops block sliding checks but cannot evade knight or double check',()=>{
 const g=new M.Game('k3r3/8/8/8/8/8/8/4K3[N] w - - 0 1');
 assert.deepEqual(g.moves().filter(m=>m.drop).map(m=>M.square(m.to)).sort(),['e2','e3','e4','e5','e6','e7']);
 ['k7/8/8/8/8/5n2/8/4K3[N] w - - 0 1','k3r3/8/8/8/1b6/8/8/4K3[N] w - - 0 1'].forEach(f=>assert.equal(new M.Game(f).moves().filter(m=>m.drop).length,0));
});
test('a drop can give checkmate and a reserve can prevent stalemate',()=>{
 const g=new M.Game('7k/8/5K2/8/8/8/8/8[Q] w - - 0 1');const m=g.parse('Q@g7#');assert(m);assert.equal(g.san(m),'Q@g7#');g.make(m);assert.match(g.status(),/Checkmate/);
 const s=new M.Game('7k/5Q2/6K1/8/8/8/8/8[n] b - - 0 1');assert(!/Draw/.test(s.status()));assert(s.moves().every(m=>m.drop));
});
test('promoted pieces return as pawns, including after moving',()=>{
 const g=new M.Game('1r5k/P7/8/8/8/8/8/K7[] w - - 0 1');move(g,'a8=Q');assert(g.fen().includes('Q~'));move(g,'Rxa8');assert.equal(g.pockets.b.p,1);assert.equal(g.pockets.b.q,0);g.undo();assert(g.promoted[M.index('a8')]);
 const h=new M.Game('7k/8/8/8/4Q~3/8/8/K7[] w - - 0 1');move(h,'Qe5');assert(h.promoted[M.index('e5')]);assert(!h.promoted[M.index('e4')]);assert.equal(new M.Game(h.fen()).fen(),h.fen());
});
test('en passant enters reserve and a dropped pawn may double step',()=>{
 const g=new M.Game('7k/8/8/3pP3/8/8/8/K7[] w - d6 0 1');move(g,'exd6');assert.equal(g.pockets.w.p,1);assert.equal(g.b[M.index('d5')],'');
 const h=new M.Game('7k/8/8/8/8/8/8/K7[P] w - - 0 1');move(h,'P@e2');move(h,'Kh7');move(h,'e4');assert.equal(h.ep,M.index('e3'));
});
test('castling survives normal play but dropped rooks do not restore rights',()=>{
 const g=new M.Game('r3k2r/8/8/8/8/8/8/R3K2R[] w KQkq - 0 1');assert(g.parse('O-O'));assert(g.parse('O-O-O'));move(g,'O-O');assert.equal(g.b[M.index('f1')],'R');g.undo();assert.equal(g.rights,'KQkq');
 const h=new M.Game('4k3/8/8/8/8/8/8/4K3[R] w - - 0 1');move(h,'R@h1');move(h,'Kd7');assert(!h.parse('O-O'));
});
test('draw and repetition rules include reserves and promotion state',()=>{
 const g=new M.Game('7k/8/6K1/8/8/8/8/R7[] w - - 100 60');assert(!g.draw());assert(!new M.Game('7k/8/6K1/8/8/8/8/8[] w - -').draw());
 const repeat=new M.Game(M.CRAZY_START);['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8'].forEach(s=>move(repeat,s));assert.match(repeat.draw(),/threefold/);
 assert.notEqual(new M.Game('7k/8/6K1/8/8/8/8/Q7[] w - -').key(),new M.Game('7k/8/6K1/8/8/8/8/Q~7[] w - -').key());
 assert.notEqual(new M.Game('7k/8/6K1/8/8/8/8/8[P] w - -').key(),new M.Game('7k/8/6K1/8/8/8/8/8[p] w - -').key());
});
test('invalid reserves and promoted markers are rejected',()=>{
 ['7k/8/8/8/8/8/8/K7[K] w - -','7k/8/8/8/8/8/P~7/K7[] w - -','7k/8/8/8/8/8/8/K~7[] w - -'].forEach(f=>assert.throws(()=>new M.Game(f)));
});
test('search finds a mating drop without changing the position',()=>{
 const g=new M.Game('7k/8/5K2/8/8/8/8/8[Q] w - - 0 1'),fen=g.fen(),key=g.key();const r=M.search(g,{depth:1,timeMs:3000});assert(r.move);assert.equal(g.fen(),fen);assert.equal(g.key(),key);g.make(r.move);assert.match(g.status(),/Checkmate/);
});
test('seeded play preserves pieces, FEN and legal engine replies',()=>{
 let seed=7321,g=new M.Game(M.CRAZY_START);
 for(let i=0;i<120;i++){
  const legal=g.moves();if(!legal.length||g.draw()){g=new M.Game(M.CRAZY_START);continue;}
  const fen=g.fen(),keys=g.keys.slice();const r=M.search(g,{depth:1,timeMs:12});assert(legal.some(m=>M.uci(m)===M.uci(r.move)));assert.equal(g.fen(),fen);assert.deepEqual(g.keys,keys);
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;g.make(legal[seed%legal.length]);
  const count=g.b.filter(Boolean).length+Object.values(g.pockets.w).reduce((a,b)=>a+b,0)+Object.values(g.pockets.b).reduce((a,b)=>a+b,0);assert.equal(count,32);
  assert.equal(new M.Game(g.fen()).fen(),g.fen());
 }
});
console.log(checks+' Crazyhouse test groups passed');
