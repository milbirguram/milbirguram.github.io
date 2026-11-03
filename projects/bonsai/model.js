(function(root){'use strict';var TYPES={

ficus:{name:'Ficus',latin:'Ficus microcarpa',evergreen:true,home:'greenhouse',dry:.2,wet:.87,evap:.11,cold:12,guide:'Tropical and evergreen. Keep it warm and bright; water when the surface begins to dry. No cold winter dormancy.',repot:'Warm growing conditions; this garden uses spring or summer.'},

juniper:{name:'Juniper',latin:'Juniperus procumbens',evergreen:true,home:'terrace',dry:.18,wet:.8,evap:.09,cold:-8,guide:'An outdoor evergreen. Give it sun, seasonal cooling and drainage; let the surface dry a little. Preserve green foliage when pruning.',repot:'Early spring; keep plenty of healthy foliage.'},

maple:{name:'Japanese maple',latin:'Acer palmatum',evergreen:false,home:'shelter',dry:.3,wet:.88,evap:.14,cold:-5,guide:'An outdoor deciduous tree. Keep moisture steady and shelter leaves from harsh summer exposure. Autumn colour and bare winter branches are normal.',repot:'Early spring before the new canopy fills; this tool only lightly trims new growth.'},

jade:{name:'Dwarf jade',latin:'Portulacaria afra',evergreen:true,home:'greenhouse',dry:.08,wet:.72,evap:.055,cold:10,guide:'A warm, bright succulent. Stored water makes it resilient to dryness; persistent wetness is much worse. It is not Crassula ovata.',repot:'Warm active growth; this garden uses spring or summer.'}};

var SEASONS=['Spring','Summer','Autumn','Winter'];function clamp(x,a,b){return Math.max(a,Math.min(b,x));}

function plant(type,id){if(!Object.prototype.hasOwnProperty.call(TYPES,type))throw Error('Unknown species');return {id:id||type+'-'+Date.now(),type:type,name:TYPES[type].name,place:TYPES[type].home,moisture:type==='jade'?.38:.5,nutrients:.68,health:88,foliage:.8,roots:.58,bend:0,wired:false,wireDays:0,lastFeed:-10,lastRepot:-120,lastPrune:-10,age:0,wetDays:0,history:[]};}

function garden(){return {version:1,day:0,selected:'juniper',plants:[plant('juniper','juniper'),plant('maple','maple'),plant('ficus','ficus')],journal:[{day:0,text:'Three trees, three rhythms. The garden waits while you are away.'}]};}

function season(g){return Math.floor(g.day/30)%4;}

function conditions(g,p){var s=season(g),outside=[16,27,13,4][s]+Math.sin(g.day*.7)*2,inside=p.place==='greenhouse';return {season:SEASONS[s],temperature:inside?22:outside,sun:inside?5:p.place==='shelter'?3.5:7,dormant:!['ficus','jade'].includes(p.type)&&s===3};}

function note(g,text){g.journal.push({day:g.day,text:text});if(g.journal.length>80)g.journal.shift();}

function step(g){g.day++;g.plants.forEach(function(p){var t=TYPES[p.type],c=conditions(g,p),stress=0,evap=t.evap*(.65+c.sun/12)*(c.temperature/22)*(c.dormant?.35:1);p.age++;p.moisture=clamp(p.moisture-evap,0,1);p.nutrients=clamp(p.nutrients-(c.dormant?.002:.009),0,1);p.wetDays=p.moisture>t.wet?p.wetDays+1:0;

if(p.moisture<t.dry)stress+=(t.dry-p.moisture)*(p.type==='jade'?9:20);if(p.wetDays>1)stress+=(p.moisture-t.wet)*30+2;if(c.temperature<t.cold)stress+=(t.cold-c.temperature)*.5;if(['juniper','maple'].includes(p.type)&&p.place==='greenhouse')stress+=2.5;if(p.type==='maple'&&season(g)===1&&p.place==='terrace')stress+=1.7;if(p.nutrients<.1&&!c.dormant)stress+=.3;if(p.roots>.92)stress+=.4;

if(p.wired){p.wireDays++;if(p.wireDays>18)stress+=1.8;}p.health=clamp(p.health+(c.dormant?.15:.8)-stress,5,100);

if(!c.dormant&&stress<1&&p.health>45&&p.nutrients>.1){var grow=.008*p.health/100*(.4+p.nutrients);p.foliage=clamp(p.foliage+grow,.15,1.3);p.roots=clamp(p.roots+.002,0,1);}p.history.push({day:g.day,moisture:p.moisture,health:p.health});if(p.history.length>30)p.history.shift();});return g;}

function status(g,p){var t=TYPES[p.type],c=conditions(g,p);if(c.temperature<t.cold)return 'Cold stress · move to warmth';if(['juniper','maple'].includes(p.type)&&p.place==='greenhouse')return 'Needs outdoor seasonal conditions';if(p.wired&&p.wireDays>14)return 'Check the wire · remove before it bites';if(p.moisture>t.wet)return 'Wet soil · let the roots breathe';if(p.moisture<t.dry+.06)return p.type==='jade'?'Soil is dry · inspect before watering':'Surface drying · ready for water';if(c.dormant)return 'Winter rest · less water, no feeding';if(p.type==='maple'&&season(g)===1&&p.place==='terrace')return 'Summer exposure · move to shelter';if(p.nutrients<.1&&!c.dormant)return 'Growth paused · nutrients are low';if(p.roots>.92)return 'Root space is tight · plan seasonal root work';if(p.health<50)return 'Recovering · keep care gentle';return 'Settled · observe before doing more';}

function action(g,id,kind,value){var p=g.plants.find(function(p){return p.id===id;});if(!p)throw Error('Choose a tree');var t=TYPES[p.type],c=conditions(g,p),message='';

if(kind==='water'){if(p.moisture>.78)message='The soil is already wet. Let it drain before adding more.';else{p.moisture=.94;message=p.name+' watered through; the next drying cycle will depend on species and position.';}}

else if(kind==='feed'){if(c.dormant)message='Resting trees do not need feeding.';else if(p.health<40||p.moisture<.15)message='Let the tree recover and check water before feeding.';else if(g.day-p.lastFeed<7)message='Nutrients are still available. Wait before feeding again.';else{p.nutrients=clamp(p.nutrients+.3,0,1);p.lastFeed=g.day;message=p.name+' fed lightly for active growth.';}}

else if(kind==='prune'){if(c.dormant||p.health<55||p.foliage<.45)message='Keep the living canopy while this tree rests or recovers.';else if(g.day-p.lastPrune<4)message='Let new growth respond before trimming again.';else{p.foliage=Math.max(.3,p.foliage-.16);p.health=clamp(p.health-2,5,100);p.lastPrune=g.day;message=p.name+': a little new growth removed; living foliage remains.';}}

else if(kind==='repot'){var warm=['ficus','jade'].includes(p.type),allowed=warm?(season(g)===0||season(g)===1):season(g)===0;if(!allowed)message='This is not the right simulated root-work season. '+t.repot;else if(g.day-p.lastRepot<60)message='Roots were recently disturbed. Give them time.';else if(p.health<55)message='A weak tree needs recovery before root work.';else{p.roots=.2;p.health-=7;p.lastRepot=g.day;message=p.name+' repotted with fresh, draining soil; allow gentle recovery.';}}

else if(kind==='place'){if(!['greenhouse','terrace','shelter'].includes(value))throw Error('Unknown place');p.place=value;message=p.name+' moved to '+{greenhouse:'the warm glasshouse',terrace:'the sunny terrace',shelter:'the sheltered terrace'}[value]+'.';}

else if(kind==='wire'){if(p.wired){p.wired=false;p.wireDays=0;message='Wire removed; the chosen shape remains.';}else if(p.health<45)message='Wait until the tree is stronger before wiring.';else{p.wired=true;p.wireDays=0;message='Wire fitted. Bend gently and check it as the tree grows.';}}

else if(kind==='bend'){if(!p.wired)message='Fit wire before shaping the trunk.';else{if(!Number.isFinite(value))throw Error('Invalid bend');p.bend=clamp(value,-.65,.65);message='The wired trunk has a new line.';}}

else throw Error('Unknown care action');note(g,message);return message;}

function restore(text){var g=JSON.parse(text);if(g.version!==1||!Number.isInteger(g.day)||g.day<0||g.day>100000||!Array.isArray(g.plants)||g.plants.length<1||g.plants.length>6)throw Error('Invalid garden');var ids=new Set();g.plants.forEach(function(p){if(!Object.prototype.hasOwnProperty.call(TYPES,p.type)||typeof p.id!=='string'||ids.has(p.id)||!['greenhouse','terrace','shelter'].includes(p.place))throw Error('Invalid tree');ids.add(p.id);p.name=String(p.name||TYPES[p.type].name).slice(0,40);['moisture','nutrients','foliage','roots','health','bend','wireDays','lastFeed','lastRepot','lastPrune','age','wetDays'].forEach(function(k){if(!Number.isFinite(p[k]))throw Error('Invalid tree state');});['lastFeed','lastRepot','lastPrune'].forEach(function(k){if(!Number.isInteger(p[k])||p[k]>g.day||p[k]<-10000)throw Error('Invalid care date');});['age','wireDays','wetDays'].forEach(function(k){if(!Number.isInteger(p[k])||p[k]<0||p[k]>100000)throw Error('Invalid counter');});p.moisture=clamp(p.moisture,0,1);p.health=clamp(p.health,5,100);p.nutrients=clamp(p.nutrients,0,1);p.foliage=clamp(p.foliage,.15,1.3);p.roots=clamp(p.roots,0,1);p.bend=clamp(p.bend,-.65,.65);p.wired=!!p.wired;p.history=[];});g.journal=Array.isArray(g.journal)?g.journal.slice(-80).map(function(e){return {day:Number(e.day)||0,text:String(e.text).slice(0,240)};}):[];if(!ids.has(g.selected))g.selected=g.plants[0].id;return g;}

var api={TYPES:TYPES,SEASONS:SEASONS,plant:plant,garden:garden,season:season,conditions:conditions,step:step,status:status,action:action,restore:restore};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Bonsai=api;

})(typeof self!=='undefined'?self:this);
