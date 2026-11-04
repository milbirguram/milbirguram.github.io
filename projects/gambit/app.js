(function () {
  'use strict';
  var M = Gambit, $ = function (id) { return document.getElementById(id); };
  var g = new M.Game(M.CRAZY_START), human = 'w', local = false, flipped = false;
  var selected = -1, reserve = '', busy = false, worker = null, job = 0, history = [], candidates = [], drag = null;
  var shapes = {p:'M30 18a8 8 0 1 0 0 16a8 8 0 1 0 0-16M25 34L22 46H38L35 34ZM20 47H40L44 54H16Z',r:'M17 17H23V23H27V17H33V23H37V17H43V30L37 34V46H23V34L17 30ZM19 47H41L44 54H16Z',n:'M20 46L24 35L18 32L22 22L29 16L29 10L37 17L43 28L40 46ZM19 47H41L44 54H16ZM25 26L29 25',b:'M30 11Q13 24 25 33L23 46H37L35 33Q47 24 30 11ZM24 23L32 29M19 47H41L44 54H16Z',q:'M17 20L24 28L30 15L36 28L43 20L38 44H22ZM19 47H41L44 54H16ZM14 17a3 3 0 1 0 6 0a3 3 0 1 0-6 0M27 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M40 17a3 3 0 1 0 6 0a3 3 0 1 0-6 0',k:'M30 9V22M24 15H36M30 25Q12 17 18 32L24 45H36L42 32Q48 17 30 25ZM19 47H41L44 54H16Z'};
  var names = {p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'};
  function piece(p) { return '<svg viewBox="0 0 60 60" aria-hidden="true"><path d="' + shapes[p.toLowerCase()] + '" fill="' + (M.colour(p)==='w'?'#fff4d6':'#25231f') + '" stroke="' + (M.colour(p)==='w'?'#4e3e2d':'#d6bc89') + '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>'; }
  function cell(s) { var r=s>>4,f=s&7; return flipped?{x:7-f,y:7-r}:{x:f,y:r}; }
  function ended() { return /^(Draw|Checkmate)/.test(g.status()); }
  function canPlay() { return !busy && (local || g.turn===human) && !ended(); }
  function clearSelection() { selected=-1; reserve=''; }
  function renderPocket(id, side) {
    var tray=$(id); tray.textContent='';
    var label=document.createElement('span');label.className='reserve-label';label.textContent=(side==='w'?'White':'Black')+' reserve';tray.appendChild(label);
    ['p','n','b','r','q'].forEach(function(type) {
      var count=g.pockets[side][type],button=document.createElement('button');button.type='button';button.className='reserve-piece';
      button.innerHTML=piece(side==='w'?type.toUpperCase():type)+'<span>'+count+'</span>';
      button.setAttribute('aria-label',(side==='w'?'White':'Black')+' reserve '+names[type]+': '+count);
      button.setAttribute('aria-pressed',String(reserve===type && g.turn===side));
      button.disabled=Kit.preview || !count || busy || g.turn!==side || (!local && side!==human);
      button.onclick=function(){if(!canPlay())return;selected=-1;reserve=reserve===type?'':type;render();};tray.appendChild(button);
    });
  }
  function render() {
    var board=$('board');board.innerHTML='';
    var legal=selected>=0 || reserve ? g.moves().filter(function(m){return reserve?m.drop===reserve:!m.drop&&m.from===selected;}) : [];
    for(var r=0;r<8;r++)for(var f=0;f<8;f++) {
      var s=flipped?(7-r)*16+7-f:r*16+f,p=g.b[s],b=document.createElement(Kit.preview?'div':'button');
      b.className='sq'+(((s>>4)+(s&7))%2?' dark':'')+(s===selected?' selected':'')+(legal.some(function(m){return m.to===s;})?' legal':'');
      b.dataset.square=s;b.setAttribute('aria-label',M.square(s)+(p?' '+(M.colour(p)==='w'?'White ':'Black ')+names[p.toLowerCase()]:'')+(g.promoted[s]?' (promoted)':''));
      b.innerHTML=(p?piece(p):'')+'<span class="coord">'+(f===0?M.square(s)[1]:'')+(r===7?M.square(s)[0]:'')+'</span>'+(g.promoted[s]?'<span class="promoted-mark" title="Returns as a pawn if captured">~</span>':'');
      if(!Kit.preview){b.type='button';b.onclick=function(e){if(drag&&drag.moved)return;choose(Number(e.currentTarget.dataset.square));};b.addEventListener('pointerdown',down);}
      board.appendChild(b);
    }
    renderPocket('reserve-top',flipped?'w':'b');renderPocket('reserve-bottom',flipped?'b':'w');drawArrows();
    if(!Kit.preview) {
      $('status').textContent=busy?'Computer is thinking…':g.status();$('fen').value=g.fen();
      $('side-label').textContent=local?'Two players · same device':'You play '+(human==='w'?'White':'Black');
      $('drop-hint').textContent=reserve?'Place your '+names[reserve]+' on a highlighted square.':'Capture a piece to add it to your reserve. Select a reserve piece to place it.';
      $('moves').textContent=history.map(function(h){return (h.side==='w'?h.full+'. ':history.indexOf(h)===0?h.full+'… ':'')+h.san;}).join(' ')||'Your game starts here.';
      $('undo').disabled=!g.stack.length;$('side').disabled=local;$('level').disabled=local;
    }
  }
  function drawArrows() {
    if(!Kit.preview && !$('search-details').open){$('arrows').innerHTML='';return;}
    $('arrows').innerHTML='<defs><marker id="tip" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0 0L4 2L0 4Z" fill="#71541d"/></marker></defs>'+candidates.map(function(c,i){
      var b=cell(c.move.to),a=c.move.drop?b:cell(c.move.from);
      if(c.move.drop)return '<circle cx="'+(b.x*100+50)+'" cy="'+(b.y*100+50)+'" r="35" fill="none" stroke="#71541d" stroke-width="8" stroke-dasharray="8 5"/>';
      return '<line x1="'+(a.x*100+50)+'" y1="'+(a.y*100+50)+'" x2="'+(b.x*100+50)+'" y2="'+(b.y*100+50)+'" stroke="#71541d" stroke-width="'+(10-i*2)+'" opacity=".65" marker-end="url(#tip)"/>';
    }).join('');
  }
  function line(pv) {var copy=new M.Game(g.fen());return pv.slice(0,7).map(function(m){var s=copy.san(m);copy.make(m);return s;}).join(' ');}
  function resetSearch() {candidates=[];$('depth').textContent='—';$('nodes').textContent='0';$('speed').textContent='—';$('candidates').innerHTML='<li>The computer’s next search will appear here.</li>';$('pv').textContent='—';$('terms').textContent='Board material + reserves + piece placement.';$('eval-fill').style.width='50%';document.querySelector('.eval-track').setAttribute('aria-valuenow','0');}
  function showSearch(r) {
    candidates=r.candidates;$('depth').textContent=r.partial?'partial':r.depth;$('nodes').textContent=r.nodes.toLocaleString();$('speed').textContent=Math.round(r.nodes/Math.max(1,r.elapsed)*1000).toLocaleString();
    var sign=g.turn==='w'?1:-1;
    $('candidates').innerHTML=candidates.map(function(c){var score=c.score*sign;return '<li>'+g.san(c.move)+' <span>'+(Math.abs(score)>99000?(score>0?'+':'−')+'mate':(score>=0?'+':'')+(score/100).toFixed(2))+'</span></li>';}).join('')||'<li>Time budget reached; using a legal fallback.</li>';
    if(candidates.length){$('pv').textContent=line(candidates[0].pv);var white=candidates[0].score*sign/100;$('eval-fill').style.width=(50+Math.max(-45,Math.min(45,white*6)))+'%';document.querySelector('.eval-track').setAttribute('aria-valuenow',Math.max(-10,Math.min(10,white)));var copy=new M.Game(g.fen());candidates[0].pv.forEach(function(m){copy.make(m);});var terms=M.evaluate(copy);$('terms').textContent='Board '+(terms.material/100).toFixed(2)+' + reserves '+(terms.reserve/100).toFixed(2)+' + placement '+(terms.placement/100).toFixed(2)+' = '+(terms.total/100).toFixed(2)+' pawns. Positive favours White.';}
    drawArrows();
  }
  function stop(){job++;if(worker)worker.terminate();worker=null;busy=false;}
  function engine() {
    if(Kit.preview||local||busy||g.turn===human||ended())return;
    busy=true;clearSelection();render();var id=++job;
    try {
      worker=new Worker('worker.js?v=3');
      worker.onerror=function(){stop();$('status').textContent='Computer unavailable. Choose two players to keep playing.';};
      worker.onmessage=function(e){if(e.data.id!==job)return;var r=e.data.result;showSearch(r);if(e.data.kind==='done'){worker.terminate();worker=null;busy=false;if(r.move){$('explanation').textContent=r.partial?'Partial search within the time budget.':'Last search: '+r.nodes.toLocaleString()+' positions, depth '+r.depth+'.';play(r.move,false);}}};
      worker.postMessage({id:id,fen:g.fen(),keys:g.keys,options:[{depth:2,timeMs:150},{depth:4,timeMs:600},{depth:6,timeMs:1800}][Number($('level').value)]});
    } catch(e){stop();$('status').textContent='Computer unavailable. Choose two players to keep playing.';}
  }
  function play(m,user){if(user&&!canPlay())return;history.push({san:g.san(m),side:g.turn,full:g.full});g.make(m);clearSelection();candidates=[];render();if(user)engine();}
  function choose(s) {
    if(!canPlay())return;
    var ms=(selected>=0||reserve)?g.moves().filter(function(m){return m.to===s&&(reserve?m.drop===reserve:!m.drop&&m.from===selected);}):[];
    if(ms.length){if(ms.length>1){var dlg=$('promotion'),position=g.fen();dlg.returnValue='';dlg.onclose=function(){if(g.fen()!==position)return;var m=ms.find(function(m){return m.promotion===dlg.returnValue;});if(m)play(m,true);};dlg.showModal();}else play(ms[0],true);return;}
    reserve='';selected=M.colour(g.b[s])===g.turn?s:-1;render();
  }
  function down(e){var s=Number(e.currentTarget.dataset.square);if(busy||(!local&&g.turn!==human)||M.colour(g.b[s])!==g.turn)return;drag={from:s,x:e.clientX,y:e.clientY,moved:false};}
  function newGame(){stop();g=new M.Game(M.CRAZY_START);local=$('mode').value==='local';human=$('side').value;flipped=!local&&human==='b';history=[];clearSelection();resetSearch();$('explanation').textContent='A small local engine; no opening book.';$('input-message').textContent='';$('fen-message').textContent='';render();engine();}
  if(!Kit.preview) {
    document.addEventListener('pointermove',function(e){if(drag&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>8){drag.moved=true;if(selected!==drag.from){reserve='';selected=drag.from;render();}}});
    document.addEventListener('pointerup',function(e){if(!drag)return;var old=drag;drag=null;if(old.moved){var el=document.elementFromPoint(e.clientX,e.clientY),sq=el&&el.closest('[data-square]');if(sq){reserve='';selected=old.from;choose(Number(sq.dataset.square));}drag={moved:true};setTimeout(function(){drag=null;},0);}});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'){clearSelection();render();}});
    $('new').onclick=newGame;$('side').onchange=newGame;$('mode').onchange=newGame;
    $('undo').onclick=function(){stop();if(g.undo())history.pop();if(!local&&g.turn!==human&&g.undo())history.pop();clearSelection();resetSearch();render();engine();};
    $('flip').onclick=function(){flipped=!flipped;render();};$('level').onchange=function(){if(busy){stop();engine();}};
    $('search-details').ontoggle=drawArrows;
    $('move-form').onsubmit=function(e){e.preventDefault();var m=g.parse($('move-input').value);if(!m||!canPlay()){$('input-message').textContent='Enter a legal move on your turn.';return;}$('input-message').textContent='';$('move-input').value='';play(m,true);};
    $('load-fen').onclick=function(){try{var fen=$('fen').value.trim();if(fen.indexOf('[')<0)fen=fen.replace(' ','[] ');var next=new M.Game(fen);if(next.inCheck(next.turn==='w'?'b':'w'))throw Error('The side that just moved cannot be in check');stop();g=next;history=[];human=g.turn;$('side').value=human;clearSelection();resetSearch();render();$('fen-message').textContent='Position loaded.';}catch(e){$('fen-message').textContent=e.message;}};
    $('try-drop').onclick=function(){stop();g=new M.Game('r1bqk2r/ppp2ppp/2n2n2/3pp3/3PP3/2N2N2/PPP2PPP/R1BQK2R[Bb] w KQkq - 0 1');history=[];human='w';$('side').value='w';flipped=false;clearSelection();resetSearch();render();};
    render();Kit.onPlay(function(playing){if(!playing&&busy){stop();render();}if(playing)engine();});
  } else {
    var frames=GambitPreview,i=0,timer=null;
    function frame(){g=new M.Game(frames[i]);candidates=[];render();}
    frame();Kit.onPlay(function(playing){clearInterval(timer);if(playing)timer=setInterval(function(){i=(i+1)%frames.length;frame();},1200);});
  }
})();
