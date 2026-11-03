(function (root) {
  'use strict';
  var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var VALUE = {p:100,n:320,b:330,r:500,q:900,k:0};
  var DIR = {n:[-33,-31,-18,-14,14,18,31,33],b:[-17,-15,15,17],r:[-16,-1,1,16],q:[-17,-16,-15,-1,1,15,16,17],k:[-17,-16,-15,-1,1,15,16,17]};
  function colour(p) { return p ? (p === p.toUpperCase() ? 'w' : 'b') : ''; }
  function other(c) { return c === 'w' ? 'b' : 'w'; }
  function square(s) { return 'abcdefgh'[s & 7] + (8 - (s >> 4)); }
  function index(s) { return (8 - Number(s[1])) * 16 + 'abcdefgh'.indexOf(s[0]); }
  function uci(m) { return square(m.from) + square(m.to) + (m.promotion || ''); }
  function Game(fen) { this.load(fen || START); }
  Game.prototype.load = function (fen) {
    var t = fen.trim().split(/\s+/), rows = t[0].split('/'), b = Array(128).fill('');
    if (rows.length !== 8 || !/^[wb]$/.test(t[1]) || !/^(?:-|K?Q?k?q?)$/.test(t[2]) || !/^(?:-|[a-h][36])$/.test(t[3])) throw Error('Invalid FEN');
    rows.forEach(function (row,r) { var f=0; row.split('').forEach(function(p) { if (/[1-8]/.test(p)) f+=Number(p); else { if (!/[prnbqkPRNBQK]/.test(p) || f>7) throw Error('Invalid FEN'); b[r*16+f++]=p; } }); if(f!==8) throw Error('Invalid FEN'); });
    if (b.filter(function(p){return p==='K';}).length!==1 || b.filter(function(p){return p==='k';}).length!==1) throw Error('FEN needs both kings');
    this.b=b; this.turn=t[1]; this.rights=t[2]==='-'?'':t[2]; this.ep=t[3]==='-'?-1:index(t[3]); this.half=Number(t[4]||0); this.full=Number(t[5]||1); this.stack=[];
    if (!Number.isInteger(this.half)||this.half<0||!Number.isInteger(this.full)||this.full<1) throw Error('Invalid move counters');
    if(this.attacked(this.b.indexOf('K'),'b')&&this.attacked(this.b.indexOf('k'),'w')) throw Error('Both kings in check');
    this.keys=[this.key()]; return this;
  };
  Game.prototype.fen = function () {
    var rows=[]; for(var r=0;r<8;r++){var row='',empty=0;for(var f=0;f<8;f++){var p=this.b[r*16+f];if(!p)empty++;else{if(empty)row+=empty;empty=0;row+=p;}}if(empty)row+=empty;rows.push(row);}
    return rows.join('/')+' '+this.turn+' '+(this.rights||'-')+' '+(this.ep<0?'-':square(this.ep))+' '+this.half+' '+this.full;
  };
  Game.prototype.key = function () {
    // FIDE repetition includes an en passant square only when the capture is legal.
    var ep='-', self=this;
    if(this.ep>=0){var step=this.turn==='w'?-16:16;[this.ep-step-1,this.ep-step+1].forEach(function(s){
      if(!(s&0x88)&&self.b[s]===(self.turn==='w'?'P':'p')){var m={from:s,to:self.ep,ep:true};self.make(m,false);var safe=!self.inCheck(other(self.turn));self.undo(false);if(safe)ep=square(self.ep);}
    });}
    return this.b.join('.')+' '+this.turn+' '+this.rights+' '+ep;
  };
  Game.prototype.attacked = function (s,by) {
    var b=this.b, pawn=by==='w'?'P':'p', step=by==='w'?16:-16;
    if(b[s+step-1]===pawn||b[s+step+1]===pawn)return true;
    for(var j=0;j<DIR.n.length;j++){var n=s+DIR.n[j];if(!(n&0x88)&&b[n]===(by==='w'?'N':'n'))return true;}
    for(var d=0;d<DIR.q.length;d++){var off=DIR.q[d],x=s+off,dist=1;while(!(x&0x88)){var p=b[x];if(p){if(colour(p)===by){var type=p.toLowerCase();if(type==='q'||(dist===1&&type==='k')||((Math.abs(off)===1||Math.abs(off)===16)?type==='r':type==='b'))return true;}break;}x+=off;dist++;}}
    return false;
  };
  Game.prototype.inCheck = function(c){c=c||this.turn;return this.attacked(this.b.indexOf(c==='w'?'K':'k'),other(c));};
  Game.prototype.make = function(m,track) {
    if(track===undefined)track=true;
    this.stack.push({b:this.b.slice(),turn:this.turn,rights:this.rights,ep:this.ep,half:this.half,full:this.full});
    var b=this.b,p=b[m.from],capt=b[m.to],step=this.turn==='w'?-16:16;
    b[m.to]=m.promotion?(this.turn==='w'?m.promotion.toUpperCase():m.promotion):p;b[m.from]='';
    if(m.ep)b[m.to-step]='';
    if(m.castle){var rf=m.to>m.from?m.from+3:m.from-4,rt=m.to>m.from?m.from+1:m.from-1;b[rt]=b[rf];b[rf]='';}
    if(p==='K')this.rights=this.rights.replace(/[KQ]/g,'');if(p==='k')this.rights=this.rights.replace(/[kq]/g,'');
    [[112,'Q'],[119,'K'],[0,'q'],[7,'k']].forEach(function(pair){if(m.from===pair[0]||m.to===pair[0])this.rights=this.rights.replace(pair[1],'');},this);
    this.ep=p.toLowerCase()==='p'&&Math.abs(m.to-m.from)===32?(m.to+m.from)/2:-1;
    this.half=(p.toLowerCase()==='p'||capt||m.ep)?0:this.half+1;if(this.turn==='b')this.full++;this.turn=other(this.turn);
    if(track)this.keys.push(this.key());return m;
  };
  Game.prototype.undo = function(track){if(track===undefined)track=true;var old=this.stack.pop();if(!old)return false;Object.assign(this,old);if(track)this.keys.pop();return true;};
  Game.prototype.moves = function () {
    var b=this.b,side=this.turn,out=[],self=this;
    function add(from,to,extra){if(b[to]&&b[to].toLowerCase()==='k')return;var base=Object.assign({from:from,to:to,capture:b[to]||''},extra||{});if(b[from].toLowerCase()==='p'&&(to>>4===0||to>>4===7))['q','r','b','n'].forEach(function(p){out.push(Object.assign({},base,{promotion:p}));});else out.push(base);}
    for(var s=0;s<128;s++){if(s&0x88){s+=7;continue;}var p=b[s];if(colour(p)!==side)continue;var type=p.toLowerCase();
      if(type==='p'){var step=side==='w'?-16:16,to=s+step;if(!(to&0x88)&&!b[to]){add(s,to);if((s>>4)===(side==='w'?6:1)&&!b[to+step])add(s,to+step);}
        [step-1,step+1].forEach(function(off){var t=s+off;if(t&0x88)return;if(b[t]&&colour(b[t])!==side)add(s,t);else if(t===self.ep&&b[t-step]===(side==='w'?'p':'P'))add(s,t,{ep:true,capture:side==='w'?'p':'P'});});
      }else{DIR[type].forEach(function(off){var t=s+off;while(!(t&0x88)){if(colour(b[t])===side)break;add(s,t);if(b[t]||type==='n'||type==='k')break;t+=off;}});}
    }
    var home=side==='w'?116:4,rook=side==='w'?'R':'r';
    if(b[home]===(side==='w'?'K':'k')&&!this.inCheck()){
      if(this.rights.indexOf(side==='w'?'K':'k')>=0&&b[home+3]===rook&&!b[home+1]&&!b[home+2]&&!this.attacked(home+1,other(side))&&!this.attacked(home+2,other(side)))add(home,home+2,{castle:true});
      if(this.rights.indexOf(side==='w'?'Q':'q')>=0&&b[home-4]===rook&&!b[home-1]&&!b[home-2]&&!b[home-3]&&!this.attacked(home-1,other(side))&&!this.attacked(home-2,other(side)))add(home,home-2,{castle:true});
    }
    return out.filter(function(m){self.make(m,false);var ok=!self.inCheck(side);self.undo(false);return ok;});
  };
  Game.prototype.insufficient = function(){var pieces=[];for(var s=0;s<128;s++){if(s&0x88){s+=7;continue;}if(this.b[s]&&this.b[s].toLowerCase()!=='k')pieces.push({p:this.b[s].toLowerCase(),s:s});}
    if(pieces.some(function(x){return /[pqr]/.test(x.p);}))return false;if(pieces.length<=1)return true;
    return pieces.every(function(x){return x.p==='b'&&(((x.s>>4)+(x.s&7))%2)===(((pieces[0].s>>4)+(pieces[0].s&7))%2);});};
  Game.prototype.draw = function(){if(this.insufficient())return 'Draw · insufficient material';if(this.half>=100)return 'Draw · fifty-move rule';var key=this.keys[this.keys.length-1];if(this.keys.filter(function(k){return k===key;}).length>=3)return 'Draw · threefold repetition';return '';};
  Game.prototype.status = function(){var moves=this.moves();if(!moves.length)return this.inCheck()?'Checkmate · '+(this.turn==='w'?'Black':'White')+' wins':'Draw · stalemate';return this.draw()||((this.turn==='w'?'White':'Black')+' to move'+(this.inCheck()?' · check':''));};
  Game.prototype.san = function(m){var p=this.b[m.from].toUpperCase(),text='';if(m.castle)text=m.to>m.from?'O-O':'O-O-O';else{
    text=p==='P'?'':p;var rivals=this.moves().filter(function(n){return n.from!==m.from&&n.to===m.to&&this.b[n.from].toUpperCase()===p;},this);
    if(p!=='P'&&rivals.length){if(!rivals.some(function(n){return (n.from&7)===(m.from&7);}))text+=square(m.from)[0];else if(!rivals.some(function(n){return(n.from>>4)===(m.from>>4);}))text+=square(m.from)[1];else text+=square(m.from);}
    if(m.capture||m.ep)text+=(p==='P'?square(m.from)[0]:'')+'x';text+=square(m.to);if(m.promotion)text+='='+m.promotion.toUpperCase();
    }this.make(m,false);if(this.inCheck())text+=this.moves().length?'+':'#';this.undo(false);return text;};
  Game.prototype.parse = function(text){var norm=function(s){return s.replace(/0/g,'O').replace(/[+#!?]/g,'').trim();},v=norm(text);return this.moves().find(function(m){return uci(m)===v.toLowerCase()||norm(this.san(m))===v;},this)||null;};
  function evaluate(g){var material=0,placement=0;for(var s=0;s<128;s++){if(s&0x88){s+=7;continue;}var p=g.b[s];if(!p)continue;var sign=colour(p)==='w'?1:-1,type=p.toLowerCase(),f=s&7,r=sign===1?7-(s>>4):s>>4,centre=7-Math.abs(3.5-f)-Math.abs(3.5-r),pos=0;
    if(type==='p')pos=6*r+3*(3.5-Math.abs(3.5-f));if(type==='n')pos=12*centre;if(type==='b')pos=7*centre;if(type==='r')pos=2*r;if(type==='q')pos=3*centre;if(type==='k')pos=-8*centre+(r===0&&[2,6].indexOf(f)>=0?25:0);
    material+=sign*VALUE[type];placement+=sign*pos;}
    return {material:material,placement:placement,total:material+placement};}
  function search(g,options,onDepth){options=options||{};var start=Date.now(),limit=options.timeMs||Infinity,nodes=0,killers={},aborted=false,maxDepth=options.depth||4;
    function order(moves,ply){return moves.map(function(m,i){var score=m.capture?10000+10*VALUE[m.capture.toLowerCase()]-VALUE[g.b[m.from].toLowerCase()]:0;if(m.promotion)score+=8000;if(killers[ply]===uci(m))score+=5000;return {m:m,score:score,i:i};}).sort(function(a,b){return b.score-a.score||a.i-b.i;}).map(function(x){return x.m;});}
    function node(depth,alpha,beta,ply,qleft){nodes++;if((nodes&127)===0&&Date.now()-start>limit){aborted=true;throw Error('timeout');}
      var legal=g.moves(),check=g.inCheck();if(!legal.length)return {score:check?-100000+ply:0,pv:[]};if(g.draw())return {score:0,pv:[]};
      var best=-Infinity,bestPV=[];
      if(depth<=0&&!check){best=evaluate(g).total*(g.turn==='w'?1:-1);if(best>=beta||qleft<=0)return {score:best,pv:[]};alpha=Math.max(alpha,best);legal=legal.filter(function(m){return m.capture||m.promotion;});}
      if(ply>=40)return {score:evaluate(g).total*(g.turn==='w'?1:-1),pv:[]};
      legal=order(legal,ply);for(var i=0;i<legal.length;i++){var m=legal[i],res;g.make(m);try{res=node(depth-1,-beta,-alpha,ply+1,qleft-(depth<=0?1:0));}finally{g.undo();}var score=-res.score;if(score>best){best=score;bestPV=[m].concat(res.pv);}alpha=Math.max(alpha,score);if(alpha>=beta){if(!m.capture)killers[ply]=uci(m);break;}}
      return {score:best,pv:bestPV};
    }
    var roots=g.moves(),result={move:roots[0]||null,candidates:[],depth:0,nodes:0,elapsed:0};
    if(g.draw()||!roots.length){result.move=null;return result;}
    for(var d=1;d<=maxDepth;d++){var candidates=[];try{var sorted=order(roots,0);for(var i=0;i<sorted.length;i++){var m=sorted[i],r;g.make(m);try{r=node(d-1,-Infinity,Infinity,1,6);}finally{g.undo();}candidates.push({move:m,score:-r.score,pv:[m].concat(r.pv)});}
      candidates.sort(function(a,b){return b.score-a.score||uci(a.move).localeCompare(uci(b.move));});result={move:candidates[0].move,candidates:candidates.slice(0,3),depth:d,nodes:nodes,elapsed:Math.max(1,Date.now()-start)};if(onDepth)onDepth(result);
    }catch(e){if(!aborted)throw e;break;}if(Date.now()-start>=limit)break;}
    result.nodes=nodes;result.elapsed=Math.max(1,Date.now()-start);return result;
  }
  function perft(g,d){if(d===0)return 1;var ms=g.moves();if(d===1)return ms.length;var count=0;ms.forEach(function(m){g.make(m,false);count+=perft(g,d-1);g.undo(false);});return count;}
  var api={Game:Game,START:START,square:square,index:index,uci:uci,colour:colour,evaluate:evaluate,search:search,perft:perft};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Gambit=api;
})(typeof self!=='undefined'?self:this);
