import * as THREE from './vendor/three.module.js';

const M=window.Bonsai,$=id=>document.getElementById(id),preview=window.Kit.preview;

let g=M.garden(),storage=true,renderer=null,scene,camera,roots=[],raf=0,playing=false,yaw=.12,distance=10,focus=!preview&&innerWidth<650,drag=null,waterUntil=0,revision=0;

if(!preview){try{const text=localStorage.getItem('bonsai-garden-v1');if(text)g=M.restore(text);}catch(e){storage=false;}}

const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};

function save(){if(preview)return;try{localStorage.setItem('bonsai-garden-v1',JSON.stringify(g));$('save-state').textContent='Garden saved in this browser';}catch(e){storage=false;$('save-state').textContent='Session only · export to keep your garden';}}

const selected=()=>g.plants.find(p=>p.id===g.selected)||g.plants[0];

function rng(seed){let s=seed>>>0||1;return()=>{s=Math.imul(s^s>>>15,1|s);s^=s+Math.imul(s^s>>>7,61|s);return((s^s>>>14)>>>0)/4294967296;};}

function seed(text){let n=5381;for(const c of text)n=(Math.imul(n,33)^c.charCodeAt(0))>>>0;return n;}

function material(color,roughness=.8){return new THREE.MeshStandardMaterial({color,roughness});}

function mesh(geo,mat,parent,position,scale){const m=new THREE.Mesh(geo,mat);if(position)m.position.set(...position);if(scale)m.scale.set(...scale);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}

function tube(points,r0,r1,parent,mat){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),geo=new THREE.TubeGeometry(curve,20,r0,7,false),a=geo.attributes.position;for(let ring=0;ring<=20;ring++){const t=ring/20,c=curve.getPointAt(t),scale=1-t*(1-r1/r0);for(let j=0;j<=7;j++){const i=ring*8+j;a.setXYZ(i,c.x+(a.getX(i)-c.x)*scale,c.y+(a.getY(i)-c.y)*scale,c.z+(a.getZ(i)-c.z)*scale);}}geo.computeVertexNormals();return mesh(geo,mat,parent);}

function treeObject(p){const root=new THREE.Group();root.userData.treeId=p.id;const random=rng(seed(p.id)),bark=material(p.type==='jade'?'#8d8267':'#6e5c49'),potColors={juniper:'#486c70',maple:'#826353',ficus:'#a9aa8c',jade:'#9b6950'},potMat=new THREE.MeshStandardMaterial({color:potColors[p.type],roughness:.31,metalness:.07});

const pot=mesh(new THREE.CylinderGeometry(.68,.53,.34,40),potMat,root,[0,.06,0],[p.type==='maple'?1.3:1.12,1,.86]);mesh(new THREE.TorusGeometry(.66,.037,6,48),potMat,root,[0,.24,0],[p.type==='maple'?1.3:1.12,.86,1]).rotation.x=Math.PI/2;for(let i=0;i<3;i++){const a=i*Math.PI*2/3;mesh(new THREE.CylinderGeometry(.08,.1,.12,10),potMat,root,[Math.cos(a)*.38,-.16,Math.sin(a)*.32]);}

const soil=material(p.moisture>.65?'#3e3a2d':'#6c6650');mesh(new THREE.CylinderGeometry(.63,.63,.035,40),soil,root,[0,.23,0],[1.12,1,.86]);for(let i=0;i<16;i++){const a=random()*6.28,r=Math.sqrt(random())*.56;mesh(new THREE.IcosahedronGeometry(.1+random()*.1,1),material(i%3?'#798464':'#a4a58a'),root,[Math.cos(a)*r,.26,Math.sin(a)*r*.8],[1,.25,1]);}

const trunk=[[0,.25,0],[-.11,.8,.04],[.12+p.bend*.3,1.35,-.03],[p.bend+.08,2.05,.02]];tube(trunk,p.type==='jade'?.13:.115,.028,root,bark);for(let i=0;i<6;i++){const a=i/6*6.28;tube([[0,.33,0],[Math.cos(a)*.18,.3,Math.sin(a)*.18],[Math.cos(a)*.38,.26,Math.sin(a)*.35]],.045,.008,root,bark);}

const clusters=[];for(let i=0;i<8;i++){const h=.85+i*.145,side=i%2?1:-1,a=i*2.4,length=.47+(1-i/11)*.3,x=side*length+p.bend*(h/2),z=Math.sin(a)*.42;const branch=[[p.bend*(h/2)*.65,h,0],[x*.65,h+.05,z*.6],[x,h+.22,z]];tube(branch,.04*(1-i*.065),.008,root,bark);clusters.push([x,h+.26,z]);}clusters.push([p.bend+.08,2.13,0]);

if(p.wired){const wire=material('#ac764c',.35),points=[];for(let i=0;i<=100;i++){const t=i/100,h=.35+t*1.6,angle=t*23;points.push([p.bend*(h/2)*.65+Math.cos(angle)*(.12-.05*t),h,Math.sin(angle)*(.12-.05*t)]);}tube(points,.012,.012,root,wire);}

const dormant=p.type==='maple'&&M.season(g)===3;let leafGeo;if(p.type==='maple'){const shape=new THREE.Shape();for(let i=0;i<14;i++){const a=i/14*Math.PI*2,r=i%2?.045:.11,x=Math.cos(a)*r,y=Math.sin(a)*r;if(i)shape.lineTo(x,y);else shape.moveTo(x,y);}shape.closePath();leafGeo=new THREE.ShapeGeometry(shape);}else leafGeo=new THREE.IcosahedronGeometry(1,p.type==='juniper'?0:1);

const count=dormant?0:Math.round((p.type==='juniper'?760:500)*p.foliage),leaves=new THREE.InstancedMesh(leafGeo,new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.85,side:THREE.DoubleSide}),Math.max(1,count)),dummy=new THREE.Object3D(),color=new THREE.Color(),season=M.season(g),health=p.health/100;

for(let i=0;i<count;i++){const centre=clusters[i%clusters.length],r=Math.cbrt(random()),a=random()*6.28,z=2*random()-1,flat=p.type==='juniper'?.19:.32;dummy.position.set(centre[0]+Math.cos(a)*r*.43,centre[1]+z*r*flat,centre[2]+Math.sin(a)*r*.38);dummy.rotation.set(random()*Math.PI,random()*6.28,random()*6.28);const size=.65+random()*.7;if(p.type==='maple')dummy.scale.setScalar(size);else if(p.type==='juniper')dummy.scale.set(.08*size,.045*size,.12*size);else if(p.type==='jade')dummy.scale.set(.095*size,.05*size,.065*size);else dummy.scale.set(.11*size,.025*size,.055*size);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);if(p.type==='maple'&&season===2)color.setHSL(.025+random()*.08,.55,.25+random()*.16);else if(p.type==='maple')color.setHSL(.25+random()*.08,.42,.2+random()*.18);else color.setHSL(p.type==='juniper'?.29+random()*.06:.24+random()*.07,.28+random()*.2,.16+random()*.13);if(health<.6)color.lerp(new THREE.Color('#b6a168'),(.6-health)*1.3);leaves.setColorAt(i,color);}leaves.count=count;leaves.castShadow=true;leaves.receiveShadow=true;root.add(leaves);root.userData.leaves=leaves;

if(p.id===g.selected){const ring=mesh(new THREE.TorusGeometry(.83,.014,6,60),material('#b18b53'),root,[0,-.225,0],[1,.86,1]);ring.rotation.x=Math.PI/2;}return root;}

function clearGroup(group){group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const list=Array.isArray(o.material)?o.material:[o.material];list.forEach(m=>m.dispose());}});scene.remove(group);}

let bench=null;function rebuild(){revision++;if(!renderer){fallback();return;}roots.forEach(clearGroup);roots=[];if(bench)clearGroup(bench);bench=new THREE.Group();const width=Math.max(7,g.plants.length*2.12+1);mesh(new THREE.BoxGeometry(width,.16,2.2),material('#95866b'),bench,[0,-.32,0]);for(const x of [-width/2+.4,width/2-.4])for(const z of [-.7,.7])mesh(new THREE.CylinderGeometry(.045,.065,1.05,8),material('#415448'),bench,[x,-.9,z]);scene.add(bench);g.plants.forEach((p,i)=>{const root=treeObject(p);root.position.set((i-(g.plants.length-1)/2)*2.13,0,Math.sin(i*1.4)*.12);scene.add(root);roots.push(root);});renderOnce();}

function fallback(){const root=$('view');root.querySelectorAll('svg').forEach(n=>n.remove());const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 600 400');svg.style.cssText='width:100%;height:100%';svg.innerHTML='<rect width="600" height="400" fill="#dfe5d8"/><path d="M300 320Q270 220 305 105" stroke="#6e5c49" stroke-width="24" fill="none"/><g fill="#5b7954"><ellipse cx="250" cy="170" rx="100" ry="45"/><ellipse cx="350" cy="130" rx="90" ry="40"/><ellipse cx="300" cy="85" rx="65" ry="40"/></g><path d="M220 315H380L365 365H235Z" fill="#486c70"/>';root.appendChild(svg);$('loading').hidden=true;}

function renderOnce(){if(!renderer)return;const target=new THREE.Vector3(0,1,0);if(focus){const index=g.plants.findIndex(p=>p.id===g.selected);if(roots[index])target.x=roots[index].position.x;}const d=focus?5.2/Math.min(1,camera.aspect/1.1):Math.max(8.6,g.plants.length*2.8)/Math.min(1,camera.aspect/1.55);camera.position.set(target.x+Math.sin(yaw)*d,4.2,target.z+Math.cos(yaw)*d);camera.lookAt(target);renderer.render(scene,camera);}

try{scene=new THREE.Scene();scene.background=new THREE.Color('#dfe5d8');scene.fog=new THREE.Fog('#dfe5d8',14,35);camera=new THREE.PerspectiveCamera(35,1,.1,80);renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;$('view').appendChild(renderer.domElement);scene.add(new THREE.HemisphereLight('#fff9e8','#8eaa83',1.45));const sun=new THREE.DirectionalLight('#fff0d5',2.6);sun.position.set(-4,9,6);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-11;sun.shadow.camera.right=11;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-8;sun.shadow.normalBias=.03;scene.add(sun);mesh(new THREE.PlaneGeometry(120,120),material('#c5d0bb'),scene,[0,-1.45,0]).rotation.x=-Math.PI/2;

const wall=material('#e4e9db');mesh(new THREE.BoxGeometry(25,7,.2),wall,scene,[0,1,-5]);for(let x=-12;x<13;x+=3)mesh(new THREE.BoxGeometry(.075,7,.1),material('#b7bfa8'),scene,[x,1,-4.8]);mesh(new THREE.BoxGeometry(25,.07,.1),material('#b7bfa8'),scene,[0,3.8,-4.8]);$('loading').hidden=true;

const resize=()=>{const r=$('view').getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();renderOnce();};new ResizeObserver(resize).observe($('view'));resize();

const canvas=renderer.domElement;canvas.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY,last:e.clientX,moved:false};canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(!drag)return;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>4)drag.moved=true;yaw-=(e.clientX-drag.last)*.007;drag.last=e.clientX;renderOnce();};canvas.onpointerup=e=>{if(drag&&!drag.moved&&!preview){const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=ray.intersectObjects(roots,true)[0];if(hit){let obj=hit.object;while(obj&&!obj.userData.treeId)obj=obj.parent;if(obj){g.selected=obj.userData.treeId;$('feedback').textContent=M.status(g,selected())+'.';refresh();save();}}}drag=null;};canvas.onpointercancel=()=>drag=null;

}catch(e){renderer=null;fallback();$('loading').hidden=true;}

function refresh(){const p=selected(),type=M.TYPES[p.type];$('season').textContent=M.SEASONS[M.season(g)];$('day').textContent='Garden day '+(g.day+1);$('tree-name').textContent=p.name;$('latin').textContent=type.latin;$('tree-status').textContent=M.status(g,p);$('place').value=p.place;$('wire').textContent=p.wired?'Remove wire':'Fit wire';$('bend').value=p.bend;$('bend').disabled=!p.wired;$('guide').textContent=type.guide;$('root-guide').textContent='Root work: '+type.repot;$('vitals').replaceChildren();[['Soil moisture',p.moisture],['Nutrients',p.nutrients],['Vigour',p.health/100],['Root space',1-p.roots]].forEach(([label,value])=>{const row=make('div','vital'),line=make('div','vital-label');line.append(make('span','',label),make('span','',Math.round(value*100)+'%'));const track=make('div','vital-track'),fill=make('div','vital-fill');fill.style.width=value*100+'%';track.appendChild(fill);row.append(line,track);$('vitals').appendChild(row);});$('trees').replaceChildren();g.plants.forEach(t=>{const b=make('button','tree-tab',t.name);b.type='button';b.setAttribute('aria-pressed',t.id===p.id?'true':'false');b.appendChild(make('small','',M.status(g,t).split(' · ')[0]));b.onclick=()=>{g.selected=t.id;$('feedback').textContent=M.status(g,t)+'.';refresh();save();};$('trees').appendChild(b);});$('journal').replaceChildren();g.journal.slice(-12).reverse().forEach(e=>$('journal').appendChild(make('li','','Day '+(e.day+1)+' — '+e.text)));rebuild();}

function doCare(kind,value){$('feedback').textContent=M.action(g,g.selected,kind,value);if(kind==='water')waterUntil=performance.now()+1200;refresh();save();}

if(!preview){document.querySelectorAll('[data-care]').forEach(b=>b.onclick=()=>doCare(b.dataset.care));$('place').onchange=()=>doCare('place',$('place').value);$('bend').onchange=()=>doCare('bend',Number($('bend').value));$('next-day').onclick=()=>{M.step(g);$('feedback').textContent='A day passes. '+M.status(g,selected())+'.';refresh();save();};$('overview').onclick=()=>{focus=false;renderOnce();};$('focus-tree').onclick=()=>{focus=true;renderOnce();};$('view').onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();yaw+=(e.key==='ArrowLeft'?-.15:.15);renderOnce();}};

Object.keys(M.TYPES).forEach(type=>{const t=M.TYPES[type],b=make('button','',t.name);b.type='button';b.appendChild(make('small','',t.latin+' · '+t.guide));b.onclick=()=>{if(g.plants.length>=6){$('feedback').textContent='Six trees fill this small garden.';$('nursery').close();return;}const p=M.plant(type,type+'-'+Date.now());g.plants.push(p);g.selected=p.id;$('feedback').textContent=p.name+' joins the garden. '+M.TYPES[p.type].guide;M.action(g,p.id,'place',p.place);$('nursery').close();focus=false;refresh();save();};$('species').appendChild(b);});$('add-tree').onclick=()=>$('nursery').showModal();$('save-export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(g,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='bonsai-garden.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};$('load-import').onclick=()=>$('garden-file').click();$('garden-file').onchange=async function(){try{const file=this.files[0];if(!file)return;if(file.size>200000)throw Error('Garden file is too large');g=M.restore(await file.text());refresh();save();$('feedback').textContent='Garden restored.';}catch(e){$('feedback').textContent=e.message;}this.value='';};}

let drops=null;if(renderer){const positions=new Float32Array(90);drops=new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(positions,3)),new THREE.PointsMaterial({color:'#dbeaf3',size:.035,transparent:true,opacity:.8}));scene.add(drops);drops.visible=false;}

function animate(t){if(!playing)return;if(preview){yaw=.12+Math.sin(t/1800)*.15;}if(drops){drops.visible=t<waterUntil;if(drops.visible){const index=g.plants.findIndex(p=>p.id===g.selected),x=roots[index]?.position.x||0,a=drops.geometry.attributes.position;for(let i=0;i<30;i++)a.setXYZ(i,x+Math.sin(i*17)*.5,.35+((i*.037+(waterUntil-t)/700)%1)*2,Math.cos(i*9)*.4);a.needsUpdate=true;}}roots.forEach((root,i)=>{if(root.userData.leaves)root.userData.leaves.rotation.z=Math.sin(t/2300+i)*.004;});renderOnce();raf=requestAnimationFrame(animate);}

refresh();if(!preview)save();Kit.onPlay(p=>{playing=p;cancelAnimationFrame(raf);if(p&&!Kit.reducedMotion)raf=requestAnimationFrame(animate);else renderOnce();});

