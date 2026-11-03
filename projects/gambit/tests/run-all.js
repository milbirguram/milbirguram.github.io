'use strict';
const assert=require('assert'),M=require('../model');
const fixtures=[['start',M.START,[20,400,8902,197281]],['Kiwipete','r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -',[48,2039,97862]],['position 3','8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -',[14,191,2812,43238]],['position 4','r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',[6,264,9467,422333]],['position 5','rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',[44,1486,62379]]];
fixtures.forEach(([name,fen,counts])=>{const g=new M.Game(fen);counts.forEach((expected,i)=>assert.strictEqual(M.perft(g,i+1),expected,name+' depth '+(i+1)));assert.strictEqual(g.fen(),new M.Game(fen).fen());console.log('Perft:',name);});
assert(/stalemate/.test(new M.Game('7k/5Q2/6K1/8/8/8/8/8 b - -').status()));
assert(/fifty-move/.test(new M.Game('7k/8/6K1/8/8/8/8/R7 w - - 100 60').status()));
['7k/8/6K1/8/8/8/8/8 w - -','7k/8/6K1/8/8/8/8/B7 w - -','7k/8/6K1/8/8/8/8/N7 w - -','7k/8/6K1/8/8/4b3/8/B7 w - -'].forEach(f=>assert(new M.Game(f).insufficient()));
assert(!new M.Game('7k/8/6K1/8/8/8/8/NN6 w - -').insufficient(),'two knights can produce a mate with cooperation');
const repeat=new M.Game();['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8'].forEach(s=>repeat.make(repeat.parse(s)));assert(/threefold/.test(repeat.status()));repeat.undo();assert(!repeat.draw());
const pinned=new M.Game('k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');assert(!pinned.moves().some(m=>m.ep));assert.strictEqual(pinned.key(),new M.Game('k3r3/8/8/3pP3/8/8/8/4K3 w - - 0 1').key());
const pawns=new M.Game('7k/8/8/3p4/2P1P3/8/8/K7 w - - 0 1');assert(pawns.parse('cxd5'));assert.strictEqual(pawns.san(pawns.parse('cxd5')),'cxd5');assert(pawns.parse('exd5'));
const promotion=new M.Game('7k/P7/6K1/8/8/8/8/8 w - -');assert.strictEqual(promotion.moves().filter(m=>m.promotion).length,4);
const san=new M.Game();['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O'].forEach(s=>{const m=san.parse(s);assert(m,s);assert.strictEqual(san.san(m),s);san.make(m);});assert.strictEqual(new M.Game(san.fen()).fen(),san.fen());
// A separate bounded minimax verifier establishes mate distance, without the engine's evaluation or search.
function forcedMate(g,plies,attacker){const legal=g.moves();if(!legal.length)return g.inCheck()&&g.turn!==attacker;if(!plies)return false;const results=[];for(const m of legal){g.make(m);results.push(forcedMate(g,plies-1,attacker));g.undo();if(g.turn===attacker&&results[results.length-1])return true;if(g.turn!==attacker&&!results[results.length-1])return false;}return g.turn!==attacker;}
const mates=require('./mates.json');assert(mates.length>=10);mates.forEach(f=>{const g=new M.Game(f.fen);assert(forcedMate(g,f.plies,g.turn));if(f.plies===3)assert(!forcedMate(g,1,g.turn),'must be mate in two');const r=M.search(g,{depth:3});assert(r.move);g.make(r.move);assert(forcedMate(g,f.plies-1,g.turn==='w'?'b':'w'),f.fen);});console.log('Verified mate puzzles:',mates.length);
const fixed=new M.Game();const a=M.search(fixed,{depth:3}),b=M.search(fixed,{depth:3});assert.deepStrictEqual(a.candidates,b.candidates);assert.strictEqual(a.nodes,b.nodes);
let seed=7823;function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
let g=new M.Game();for(let i=0;i<1000;i++){let ms=g.moves();if(!ms.length||g.draw()||i%80===0){g=new M.Game();ms=g.moves();}const r=M.search(g,{depth:1,timeMs:8});assert(ms.some(m=>M.uci(m)===M.uci(r.move)));g.make(ms[Math.floor(random()*ms.length)]);if((i+1)%200===0)console.log('Random positions checked:',i+1);}console.log('Legal engine moves: 1,000 random-play positions');console.log('Gambit: all checks passed');
