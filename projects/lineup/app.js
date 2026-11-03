(function () {

  'use strict';

  var M=Lineup,data=LineupData,$=function(id){return document.getElementById(id);};

  var prepared=M.prepare(data),playerId=null,chosen=null,all=false,priorities=[1,1,1,1],raf=0,last=0,previewIndex=0;

  var presets={balanced:[1,1,1,1],shots:[3,1,1,1],finish:[1,1,3,0.5],defend:[0.5,0.5,0.5,3]};

  function signed(x,digits){return (x<0?'−':'+')+Math.abs(x).toFixed(digits===undefined?2:digits);}

  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}

  function player(){return prepared.players.find(function(p){return p.id===playerId;});}

  function populate(){var query=$('search').value.trim().toLocaleLowerCase(),role=$('role').value,matches=prepared.players.filter(function(p){return(role==='all'||p.role===role)&&p.name.toLocaleLowerCase().indexOf(query)>=0;});

    $('player').replaceChildren();matches.forEach(function(p){var option=el('option','',p.name+' · '+p.position+' · '+p.team);option.value=p.id;$('player').appendChild(option);});

    if(!matches.some(function(p){return p.id===playerId;}))playerId=matches.length?matches[0].id:null;

    $('player').disabled=!matches.length;if(playerId)$('player').value=playerId;$('search-status').textContent=matches.length+' qualifying '+(matches.length===1?'skater':'skaters')+(query?' matching your search':'')+'.';chosen=null;all=false;render();

  }

  function profilePanel(p){$('player-name').textContent=p.name;$('player-meta').textContent=p.position+' · '+(p.role==='D'?'Defenceman':'Forward')+' · '+p.team+' in source snapshot';$('minutes').textContent=Math.round(p.minutes).toLocaleString();$('seasons').textContent=p.seasons.length;$('peer-role').textContent=p.role==='D'?'defencemen':'forwards';$('player-bars').replaceChildren();M.FEATURES.forEach(function(f,j){var row=el('div','profile-row'),label=el('div','profile-label');label.appendChild(el('span','',f.name));label.appendChild(el('strong','',Math.round(p.percentiles[j])+' / 100'));row.appendChild(label);var track=el('div','profile-track'),fill=el('div','profile-fill');fill.style.width=p.percentiles[j]+'%';track.appendChild(fill);row.appendChild(track);row.appendChild(el('p','profile-raw',p.values[j].toFixed(j===3||j===2?3:2)+' '+f.unit));$('player-bars').appendChild(row);});

    $('shrink-note').textContent=$('regularise').checked?'Regularised profile · '+Math.round(p.weightedMinutes).toLocaleString()+' recency-weighted minutes. The median tick marks the middle of the position group.':'Regularisation off · raw recency-weighted rates. Small samples and finishing can move the ranking sharply.';

  }

  function rankingPanel(ranks){$('ranking').replaceChildren();var shown=Kit.preview?3:all?ranks.length:5;ranks.slice(0,shown).forEach(function(r,i){var b=el(Kit.preview?'div':'button','team-choice');if(!Kit.preview)b.type='button';b.setAttribute('aria-pressed',chosen===r.team.id?'true':'false');b.appendChild(el('span','rank-number',i+1));var name=el('span');name.appendChild(el('span','team-name',r.team.name));name.appendChild(el('span','team-code',r.team.id));b.appendChild(name);b.appendChild(el('span','team-score',signed(r.score)));if(!Kit.preview)b.onclick=function(){chosen=r.team.id;render();};$('ranking').appendChild(b);});$('show-all').textContent=all?'Show top five':'Show all '+ranks.length+' teams';

    $('rank-status').textContent=ranks[0].score<=0?'No positive complement in this lens: the index does not find a clear statistical match.':ranks.length>1&&ranks[0].score-ranks[1].score<0.02?'The leading scores are close. Treat the order as a starting point for investigation.':'Larger scores mean stronger alignment with the measured gaps under these priorities.';

  }

  function matchPanel(p,r,ranks){$('match-team').textContent=r.team.name;$('match-score').textContent=signed(r.score);var terms=r.terms.map(function(v,j){return {v:v,j:j};}).sort(function(a,b){return b.v-a.v;}),best=terms[0],worst=terms[terms.length-1];

    var sentence=best.v>0?M.FEATURES[best.j].name+' is the largest positive term: '+p.name+' is above the position average and '+r.team.id+' has a measured gap there.':'There is no positive contribution under the selected priorities.';

    if(worst.v<0)sentence+=' '+M.FEATURES[worst.j].name+' is the largest trade-off.';sentence+=' Ranked '+(ranks.findIndex(function(x){return x.team.id===r.team.id;})+1)+' of '+ranks.length+' eligible teams.';$('match-description').textContent=sentence;

    $('contributions').replaceChildren();var max=Math.max.apply(null,r.terms.map(Math.abs).concat([.001]));M.FEATURES.forEach(function(f,j){var row=el('div','contribution-row'),name=el('div','contribution-name',f.name);name.appendChild(el('small','',Math.round(r.weights[j]*100)+'% of your priorities'));row.appendChild(name);var bar=el('div','contribution-bar'),fill=el('span',r.terms[j]<0?'negative':'');var width=Math.abs(r.terms[j])/max*46;fill.style.width=width+'%';fill.style.left=(r.terms[j]<0?50-width:50)+'%';bar.appendChild(fill);row.appendChild(bar);row.appendChild(el('span','contribution-value',signed(r.terms[j],3)));var teamValue=r.team.values[j],teamUnits=j===3?'xGA / 60 (lower is better)':f.unit;if(j===3)teamValue=-teamValue;

    row.appendChild(el('span','contribution-detail','Player '+signed(p.z[j])+' SD · team need '+r.team.need[j].toFixed(2)+' SD · team result '+teamValue.toFixed(2)+' '+teamUnits));$('contributions').appendChild(row);});

    var stability=M.sensitivity(p,prepared,data,priorities,$('include-own').checked);$('sensitivity').textContent=stability.available?'The same top team leads in '+stability.same+' of '+stability.count+' checks after dropping one player season at a time. Team needs stay fixed.': 'Only one season is available for this player; season-omission stability cannot be checked.';

  }

  function render(){var p=player();if(!p){$('player-name').textContent='No matching skater';$('player-meta').textContent='Try another name or position group.';$('player-bars').replaceChildren();$('minutes').textContent='—';$('seasons').textContent='—';$('shrink-note').textContent='';$('ranking').replaceChildren();$('rank-status').textContent='At least 300 five-on-five minutes in 2025–26 are required.';$('match-team').textContent='No player selected';$('match-score').textContent='—';$('match-description').textContent='Clear the search or choose another skater.';$('contributions').replaceChildren();$('sensitivity').textContent='';return;}

    profilePanel(p);var ranks;try{ranks=M.rank(p,prepared.teams,priorities,$('include-own').checked);}catch(e){$('ranking').replaceChildren();$('rank-status').textContent=e.message;$('match-team').textContent='Define a job';$('match-score').textContent='—';$('match-description').textContent='Set at least one priority above zero.';$('contributions').replaceChildren();$('sensitivity').textContent='';return;}

    if(!chosen||!ranks.some(function(r){return r.team.id===chosen;}))chosen=ranks[0].team.id;rankingPanel(ranks);if(!Kit.preview)matchPanel(p,ranks.find(function(r){return r.team.id===chosen;}),ranks);else $('player-meta').textContent=p.position+' · '+p.team+' / statistical fit index';

  }

  function preset(name){priorities=presets[name].slice();document.querySelectorAll('[data-preset]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.preset===name?'true':'false');});M.FEATURES.forEach(function(_,j){$('priority-'+j).value=priorities[j];$('priority-output-'+j).textContent=priorities[j].toFixed(1);});chosen=null;render();}

  $('player-count').textContent=prepared.players.length;var starting=prepared.players.find(function(p){return p.name==='Connor Bedard';})||prepared.players[0];playerId=starting.id;

  M.FEATURES.forEach(function(f,j){var term=el('dt','',f.name),definition=el('dd','',f.definition);$('definitions').appendChild(term);$('definitions').appendChild(definition);var control=el('div','slider-control'),label=el('label','slider-label');label.htmlFor='priority-'+j;label.appendChild(el('span','',f.name));var output=el('output','','1.0');output.id='priority-output-'+j;output.htmlFor='priority-'+j;label.appendChild(output);var input=el('input');input.type='range';input.id='priority-'+j;input.min='0';input.max='3';input.step='.5';input.value='1';input.oninput=function(){priorities[j]=Number(input.value);output.textContent=priorities[j].toFixed(1);document.querySelectorAll('[data-preset]').forEach(function(b){b.setAttribute('aria-pressed','false');});chosen=null;render();};control.appendChild(label);control.appendChild(input);$('sliders').appendChild(control);});

  var v=data.validation;$('validation-summary').textContent='Shrinkage was selected on '+v.tuneN+' skaters from '+v.tuneTransition+'. On a later holdout of '+v.holdoutN+' skaters ('+v.holdoutTransition+'), standardised profile RMSE was '+v.unshrunkRMSE.toFixed(3)+' without shrinkage and '+v.shrunkRMSE.toFixed(3)+' with it. Lower is better. The holdout requires 300 prior-season and 600 next-season minutes with an unchanged position group; it excludes dropouts. These are retrospective downloaded snapshots, not archived forecasts.';

  if(!Kit.preview){$('search').oninput=populate;$('role').onchange=populate;$('player').onchange=function(){playerId=Number(this.value);chosen=null;all=false;render();};$('regularise').onchange=function(){prepared=M.prepare(data,this.checked);populate();};$('include-own').onchange=function(){chosen=null;render();};$('show-all').onclick=function(){all=!all;render();};document.querySelectorAll('[data-preset]').forEach(function(b){b.onclick=function(){preset(b.dataset.preset);};});populate();

  }else{document.querySelector('.wordmark span').textContent='MoneyPuck.com data';document.querySelector('.snapshot span').textContent='5V5 / FIT INDEX';render();function loop(t){if(t-last>=3000){previewIndex=(previewIndex+1)%3;var names=['Connor Bedard','Mitch Marner','Quinn Hughes'],p=prepared.players.find(function(p){return p.name===names[previewIndex];});if(p){playerId=p.id;chosen=null;render();}last=t;}raf=requestAnimationFrame(loop);}Kit.onPlay(function(playing){cancelAnimationFrame(raf);if(playing){last=performance.now();raf=requestAnimationFrame(loop);}});}

})();
