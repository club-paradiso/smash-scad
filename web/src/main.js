// SMASH SCAD game: UI, three.js scene, weapons, scoring, particles, sound.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';
import {building} from '../geom.js';

const $=s=>document.querySelector(s);
const ICON={
 bomb:'<circle cx="13" cy="15" r="7" fill="currentColor"/><path d="M17 9l3-3M20 3v2M22 6h-2" stroke="currentColor" stroke-width="2" fill="none"/>',
 paint:'<path d="M5 9h12v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="currentColor"/><path d="M5 9l3-5h6l3 5" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="20" cy="15" r="2" fill="#ff4b3e"/><circle cx="19" cy="20" r="1.3" fill="#3fa9ff"/>',
 pencil:'<path d="M3 21l2-6L16 4l4 4L9 19z" fill="currentColor"/><path d="M3 21l2-6 4 4z" fill="#ff4b3e"/>',
 meteor:'<circle cx="15" cy="15" r="6" fill="currentColor"/><path d="M3 3l8 8M6 2l6 6M2 6l6 6" stroke="currentColor" stroke-width="2"/>',
 quake:'<path d="M2 13h4l2-6 4 12 3-9 2 3h5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linejoin="round"/>',
 nuke:'<circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 9.5L8 2.6a9 9 0 0 1 8 0zM9.8 13.3l-4 6.9a9 9 0 0 1-4-6.9zM14.2 13.3h8a9 9 0 0 1-4 6.9z" fill="currentColor"/>'
};
const WEAPONS=[
 {id:'bomb',name:'Bomb',cd:0},
 {id:'paint',name:'Paint bomb',cd:0},
 {id:'pencil',name:'Pencil',cd:.6},
 {id:'meteor',name:'Meteor',cd:3},
 {id:'quake',name:'Quake',cd:7},
 {id:'nuke',name:'Nuke',cd:20}
];
const ZONES=[
 ['Downtown',['Poetter Hall','Jen Library','Student Center']],
 ['MLK & Museum',['SCAD Museum of Art','Ex Libris','Clark Hall']],
 ['River side',['Adler Hall','Hamilton Hall','Propes Hall']],
 ['The Hive',['Hive Parking','Turner House','Clubhouse']],
 ['Midtown',['Arnold Hall','Number Nine','Forsyth House']],
 ['Victory Village',['Sail','Sand','Forage']],
 ['Montgomery',['Montgomery Hall','The Shed','Carnival']]
];
const RANKS=[['D',0],['C',3000],['B',12000],['A',35000],['S',90000],['SS',200000],['SSS',450000]];
const PAINTS=[0xff4b3e,0x3fa9ff,0x2bd47d,0xff7ad9,0x9b5cff,0xff9f1c,0x00d5c8];

const PERF=/[?&]perf\b/.test(location.search),PT={},FR=[];let frRec=false;
let weapon='bomb',score=0,combo=1,lastKill=0,best=0,muted=false,ready=false;
const cool={};
try{best=+localStorage.getItem('smashscad.best')||0}catch(e){}
$('#best').textContent=best.toLocaleString();

// ---------- renderer / scene ----------
const canvas=$('#c');
// three r152+ turned on colour management and r155 dropped legacy light units. This game's colours and
// light levels were tuned on r147 (no colour management, linear output, legacy lights), so keep that look:
// colours stay raw, output stays linear, and light intensities get the factor of PI that r147 applied internally.
THREE.ColorManagement.enabled=false;
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,logarithmicDepthBuffer:true});
renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene();
const SKY=new THREE.Color(0xcfdbe2);
scene.background=SKY;scene.fog=new THREE.Fog(SKY,900,3600);
const camera=new THREE.PerspectiveCamera(50,1,1,9000);
camera.position.set(260,330,420);
scene.add(new THREE.HemisphereLight(0xfff6e5,0x7d7466,.62*Math.PI));
const sun=new THREE.DirectionalLight(0xfff0d0,.6*Math.PI);sun.position.set(-400,700,300);scene.add(sun);
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;controls.dampingFactor=.12;controls.screenSpacePanning=false;
controls.maxPolarAngle=1.38;controls.minDistance=35;controls.maxDistance=2600;
controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
controls.touches={ONE:THREE.TOUCH.PAN,TWO:THREE.TOUCH.DOLLY_ROTATE};
function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
addEventListener('resize',resize);resize();

// ground
const ground=new THREE.Mesh(new THREE.PlaneGeometry(20000,20000),new THREE.MeshLambertMaterial({color:0xc9c0aa}));
ground.rotation.x=-Math.PI/2;scene.add(ground);

// ---------- city ----------
let city,geo,aL,col,nB=0,bS,bC,bH,bX,bZ,bR,bHp,bMax,bScad,bName,bAlive,wallC,roofC,baseW,baseR,shade,faceB,vStart,vCount,scadIdx=[];
const CHAR=new THREE.Color(0x2f2a26);
function poly(flat,y,color,list){
  const pts=[];for(let i=0;i<flat.length;i+=2)pts.push(new THREE.Vector2(flat[i],flat[i+1]));
  let tri;try{tri=THREE.ShapeUtils.triangulateShape(pts,[])}catch(e){return}
  for(const t of tri)for(const j of t)list.push(pts[j].x,y,pts[j].y);
}
function flatMesh(list,color,y){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(list,3));
  const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,fog:true}));scene.add(m);return m;
}
function buildGroundLayers(D){
  const water=[];poly(D.river,.04,0,water);for(const w of D.w)poly(w,.05,0,water);
  const wm=flatMesh(water,0x5f93ad);wm.material.color.setHex(0x5a8aa3);
  const park=[];for(const p of D.p)poly(p,.09,0,park);
  const pm=flatMesh(park,0);pm.material.color.setHex(0x8fae63);
  const rd=[];for(const [w,f] of D.r)strip(f,w==2?8:w?5.5:3.4,.07,rd);
  const rm=flatMesh(rd,0);rm.material.color.setHex(0x8a857c);
  if(D.v<3)return;
  // v3 surroundings, all from OSM tags (tools/build_ground.py): areas by kind, footpaths, rail, piers, tree rows
  const AREA=[[0x77736d,.075],[0x79a85a,.1],[0x4fb0d6,.105],[0xc8a57c,.1],[0x9db383,.095],[0x8b6b4a,.3],[0xb98aa6,.1]];
  const byKind=AREA.map(()=>[]);for(const [k,f] of D.a)poly(f,AREA[k][1],0,byKind[k]);
  byKind.forEach((l,k)=>{if(l.length)flatMesh(l,AREA[k][0])});
  const fp=[];for(const f of D.f)strip(f,1,.11,fp);if(fp.length)flatMesh(fp,0xd9d1c1);
  const rl=[];for(const f of D.rl)strip(f,1,.12,rl);if(rl.length)flatMesh(rl,0x5b544d);
  const pl=[];for(const f of D.pl)strip(f,1.6,.3,pl);if(pl.length)flatMesh(pl,0x8b6b4a);
  const tr=[];for(const f of D.tr)strip(f,2.5,.13,tr);if(tr.length)flatMesh(tr,0x5f8a3e); // a mapped tree row, not individual trees
  buildTrees(D.t);
}
// flat ribbon of half-width `half` along a polyline, pushed into `out` as triangles at height y
function strip(f,half,y,out){
  for(let i=0;i+3<f.length;i+=2){const x1=f[i],z1=f[i+1],x2=f[i+2],z2=f[i+3];const dx=x2-x1,dz=z2-z1;const L=Math.hypot(dx,dz)||1;const nx=-dz/L*half,nz=dx/L*half;
    out.push(x1+nx,y,z1+nz,x1-nx,y,z1-nz,x2+nx,y,z2+nz, x2+nx,y,z2+nz,x1-nx,y,z1-nz,x2-nx,y,z2-nz)}
}
// ---------- trees: OSM natural=tree nodes; height and crown radius measured from 2018 lidar where it found a canopy ----------
let trees=null;
const TREE_DEFAULT_H=7,TREE_DEFAULT_R=2.5; // drawn size when lidar found no canopy (est); not a measurement
function buildTrees(T){
  if(!T||!T.length)return;
  const n=T.length,crown=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshLambertMaterial(),n),
    cone=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,7),new THREE.MeshLambertMaterial(),n),
    trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(.18,.26,1,6),new THREE.MeshLambertMaterial({color:0x6b4f3a}),n);
  trees={T,n,crown,cone,trunk,down:new Uint8Array(n),x:new Float32Array(n),z:new Float32Array(n)};
  for(const m of [crown,cone,trunk]){m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(m)}
  let nc=0,nn=0;
  for(let i=0;i<n;i++){const [x,z,needle,h0,r0]=T[i];trees.x[i]=x;trees.z[i]=z;
    const h=h0||TREE_DEFAULT_H,r=Math.min(r0||TREE_DEFAULT_R,h*.6),tk=Math.max(1,h-r*(needle?1.6:1.4));
    const c=new THREE.Color(needle?0x3f6b3a:0x5d8a3c).offsetHSL(((i*37)%11-5)/200,0,((i*53)%9-4)/80);
    T[i].m={x,z,h,r,tk,needle,c};
    (needle?nn++:nc++)}
  crown.count=nc;cone.count=nn;trunk.count=n;
  for(const m of [crown,cone])m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(m.count*3),3);
  trees.slot=new Int32Array(n);let a=0,b=0;for(let i=0;i<n;i++)trees.slot[i]=T[i].m.needle?b++:a++;
  for(let i=0;i<n;i++)placeTree(i,0);
}
function placeTree(i,fall){ // fall 0 = standing, 1 = knocked flat and charred
  const {x,z,h,r,tk,needle,c}=trees.T[i].m,m=needle?trees.cone:trees.crown,s=trees.slot[i];
  const ty=fall?.05:1;
  dummy.rotation.set(0,0,0);dummy.position.set(x,tk*ty/2,z);dummy.scale.set(1,tk*ty,1);dummy.updateMatrix();trees.trunk.setMatrixAt(i,dummy.matrix);
  if(needle){dummy.position.set(x,(tk+r*.8)*ty,z);dummy.scale.set(r,(h-tk)*ty+.01,r)}else{dummy.position.set(x,(tk+r*.7)*ty,z);dummy.scale.set(r,r*.85*ty+.01,r)}
  dummy.updateMatrix();m.setMatrixAt(s,dummy.matrix);m.setColorAt(s,fall?tmpA.copy(c).lerp(CHAR,.8):c);
  trees.trunk.instanceMatrix.needsUpdate=m.instanceMatrix.needsUpdate=m.instanceColor.needsUpdate=true;
}
function blastTrees(x,z,r){if(!trees)return;for(let i=0;i<trees.n;i++)if(!trees.down[i]&&Math.hypot(trees.x[i]-x,trees.z[i]-z)<r){trees.down[i]=1;placeTree(i,1)}}
function resetTrees(){if(!trees)return;for(let i=0;i<trees.n;i++)if(trees.down[i]){trees.down[i]=0;placeTree(i,0)}}
const TILE=400,TILE_OFF=4000,tiles=[];
const tileOf=k=>Math.floor((bZ[k]+TILE_OFF)/TILE)*1000+Math.floor((bX[k]+TILE_OFF)/TILE);
function buildCity(D){
  const B=D.b;nB=B.length;
  const P=[],FB=[],SH=[],G=[];
  bS=new Uint8Array(nB);bH=new Float32Array(nB);bX=new Float32Array(nB);bZ=new Float32Array(nB);bR=new Float32Array(nB);
  bHp=new Float32Array(nB);bMax=new Float32Array(nB);bAlive=new Uint8Array(nB).fill(1);bName=[];
  vStart=new Uint32Array(nB);vCount=new Uint32Array(nB);wallC=[];roofC=[];baseW=[];baseR=[];
  const safeC=v=>{if(!v)return null;try{return new THREE.Color(v[0]=='#'||/^[0-9a-f]{6}$/i.test(v)?(v[0]=='#'?v:'#'+v):v)}catch(e){return null}};
  for(let k=0;k<nB;k++){
    const rec=B[k];const [s,name,f,holes,minH]=rec;const n=f.length/2;bS[k]=s;bName[k]=name;if(s)scadIdx.push(k);
    let cx=0,cz=0;for(let i=0;i<f.length;i+=2){cx+=f[i];cz+=f[i+1]}cx/=n;cz/=n;bX[k]=cx;bZ[k]=cz;
    let r=0;for(let i=0;i<f.length;i+=2)r=Math.max(r,Math.hypot(f[i]-cx,f[i+1]-cz));bR[k]=r;
    let area=0;for(let i=0;i<n;i++){const j=(i+1)%n;area+=f[i*2]*f[j*2+1]-f[j*2]*f[i*2+1]}area=Math.abs(area)/2;
    const g=building(THREE,rec);bH[k]=g.top;
    bMax[k]=bHp[k]=Math.max(40,Math.sqrt(area)*(g.top-minH)*.55);
    const v=(k*2654435761>>>0)%100/100;
    const tw=safeC(rec[9]),tr=safeC(rec[10]);
    const w=s?new THREE.Color().setHSL(.13,.95,.52+v*.06):(tw||new THREE.Color().setHSL(.08+v*.05,.18+v*.12,.78+v*.1));
    const rf=s?(rec[7]?new THREE.Color().setHSL(.07,.7,.42):new THREE.Color().setHSL(.12,1,.6)):(tr||(rec[7]?new THREE.Color().setHSL(.03+v*.04,.35,.42+v*.1):w.clone().multiplyScalar(.86)));
    baseW[k]=w;baseR[k]=rf;wallC[k]=w.clone();roofC[k]=rf.clone();
    G[k]=g;
  }
  // Vertex layout is grouped by TILE-metre cell so each cell is one contiguous range (see buildTiles).
  // Inside a cell buildings keep OSM order; building indices k (scores, names, list, zones) are unchanged.
  const order=[...Array(nB).keys()].sort((a,b)=>tileOf(a)-tileOf(b)||a-b);
  for(const k of order){const g=G[k];
    vStart[k]=P.length/3;
    for(let i=0;i<g.pos.length;i++)P.push(g.pos[i]);for(let i=0;i<g.shade.length;i++)SH.push(g.shade[i]);
    for(let t=0;t<g.pos.length/9;t++)FB.push(k);
    vCount[k]=P.length/3-vStart[k];
  }
  const nv=P.length/3;shade=Float32Array.from(SH);
  geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
  geo.computeVertexNormals();
  col=new THREE.BufferAttribute(new Float32Array(nv*3),3);geo.setAttribute('color',col);
  aL=new THREE.BufferAttribute(new Float32Array(nv*3),3);for(let i=0;i<nv;i++)aL.array[i*3]=1;geo.setAttribute('aL',aL);
  faceB=Uint16Array.from(FB);
  dirtyC.bind(col);dirtyL.bind(aL);
  for(let k=0;k<nB;k++)paintB(k);
  const mat=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
  mat.onBeforeCompile=sh=>{sh.vertexShader='attribute vec3 aL;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.y*=aL.x;transformed.x+=aL.y*transformed.y;transformed.z+=aL.z*transformed.y;')};
  city=new THREE.Mesh(geo,mat);buildTiles(order,mat);
  // Tap picking goes through a BVH instead of testing all 115k triangles. indirect:true keeps the geometry
  // non-indexed and in its original order, so faceIndex still maps to a building through faceB.
  // The BVH is built from the uncollapsed positions, as the plain raycast was (aL only moves vertices in the shader).
  const t0=performance.now();geo.boundsTree=new MeshBVH(geo,{indirect:true});city.raycast=acceleratedRaycast;PT.extraInit=performance.now()-t0;
  return B.reduce((a,r)=>{a.shaped+=r[7]?1:0;a.tagged+=r[11]==0?1:0;a.lidar+=r[11]==2?1:0;return a},{shaped:0,tagged:0,lidar:0});
}
// One mesh per cell, all sharing the city's attribute buffers (uploaded once), each with its own draw range and
// bounding sphere so three can frustum-cull cells; the camera usually sees about a third of the city.
// `city` itself is not drawn; it is the full mesh used for picking.
// (A distance LOD that skipped small far buildings was tried on top of this and measured no gain, so it was removed.)
function buildTiles(order,mat){
  const pos=geo.attributes.position,v=new THREE.Vector3();
  for(let i=0;i<order.length;){
    const key=tileOf(order[i]);let j=i;while(j<order.length&&tileOf(order[j])===key)j++;
    const ks=order.slice(i,j),start=vStart[ks[0]],end=vStart[ks[ks.length-1]]+vCount[ks[ks.length-1]];
    const box=new THREE.Box3();for(let q=start;q<end;q++)box.expandByPoint(v.fromBufferAttribute(pos,q));
    const sph=box.getBoundingSphere(new THREE.Sphere());sph.radius+=box.max.y*.25; // room for a collapsing building's lean
    const g=new THREE.BufferGeometry();for(const n of ['position','normal','color','aL'])g.setAttribute(n,geo.getAttribute(n));
    g.setDrawRange(start,end-start);g.boundingSphere=sph;
    const m=new THREE.Mesh(g,mat);m.matrixAutoUpdate=false;scene.add(m);
    tiles.push({m,g,sph});
    i=j}
}
function paintB(k){
  const d=1-Math.max(0,bHp[k])/bMax[k];const a=col.array;const w=tmpA.copy(wallC[k]).lerp(CHAR,d*.75),r=tmpB.copy(roofC[k]).lerp(CHAR,d*.75);
  for(let v=vStart[k],e=v+vCount[k];v<e;v++){const s=shade[v];const c=s<0?r:w;const m=Math.abs(s);a[v*3]=c.r*m;a[v*3+1]=c.g*m;a[v*3+2]=c.b*m}
  dirtyC.add(k);
}
const tmpA=new THREE.Color(),tmpB=new THREE.Color();
// Upload only the vertex ranges of buildings that changed this frame, instead of the whole 345k-vertex
// attribute. Neighbouring ranges closer than GAP vertices are merged; when the merged ranges would cover
// more than half the buffer, or there are too many of them, one full upload is cheaper.
function rangeTracker(){
  const GAP=512,MAXR=96,FULL=.5;let mark=null,list=[],attr=null;
  return {bind(a){attr=a;mark=new Uint8Array(nB)},
    add(k){if(!mark[k]){mark[k]=1;list.push(k)}},
    flush(){if(!list.length)return;list.sort((a,b)=>vStart[a]-vStart[b]);
      const R=[];let s=-1,e=-1,cov=0;
      for(const k of list){mark[k]=0;const a=vStart[k],b=a+vCount[k];if(s<0){s=a;e=b}else if(a-e<=GAP)e=Math.max(e,b);else{R.push(s,e);cov+=e-s;s=a;e=b}}
      R.push(s,e);cov+=e-s;list=[];
      attr.clearUpdateRanges();
      if(R.length/2<=MAXR&&cov<attr.count*FULL)for(let i=0;i<R.length;i+=2)attr.addUpdateRange(R[i]*3,(R[i+1]-R[i])*3);
      attr.needsUpdate=true}};
}
const dirtyC=rangeTracker(),dirtyL=rangeTracker();
function flushAttrs(){dirtyL.flush();dirtyC.flush()}
function setL(k,s,lx,lz){const a=aL.array;for(let v=vStart[k],e=v+vCount[k];v<e;v++){a[v*3]=s;a[v*3+1]=lx;a[v*3+2]=lz}dirtyL.add(k)}

// ---------- particles ----------
const MAXD=700,MAXP=360;
const debris=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshLambertMaterial(),MAXD);
const puffs=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),new THREE.MeshLambertMaterial(),MAXP);
for(const m of [debris,puffs]){m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.frustumCulled=false;m.count=0;scene.add(m);
  m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array((m===debris?MAXD:MAXP)*3),3)}
const D_=[],P_=[];
const dummy=new THREE.Object3D();
function spawnDebris(x,y,z,c,n,pow){for(let i=0;i<n;i++){if(D_.length>=MAXD)D_.shift();
  D_.push({x:x+(Math.random()-.5)*8,y:y*Math.random(),z:z+(Math.random()-.5)*8,vx:(Math.random()-.5)*pow,vy:Math.random()*pow*.9+4,vz:(Math.random()-.5)*pow,s:1+Math.random()*3.2,rx:Math.random()*6,ry:Math.random()*6,c:c.clone().multiplyScalar(.7+Math.random()*.4),t:0,life:3+Math.random()*2})}}
function spawnPuff(x,y,z,c,s,n,rise){for(let i=0;i<n;i++){if(P_.length>=MAXP)P_.shift();
  P_.push({x:x+(Math.random()-.5)*s*2,y:y+Math.random()*s,z:z+(Math.random()-.5)*s*2,vy:rise*(.5+Math.random()),vx:(Math.random()-.5)*4,vz:(Math.random()-.5)*4,s:s*(.6+Math.random()*.7),c:new THREE.Color(c),t:0,life:1.6+Math.random()*1.6})}}
function stepParticles(dt){
  let i=0;for(const p of D_){p.t+=dt;p.vy-=30*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;if(p.y<p.s*.5){p.y=p.s*.5;p.vy*=-.25;p.vx*=.6;p.vz*=.6}
    p.rx+=dt*p.vx*.2;const sc=p.t>p.life-.6?Math.max(.01,(p.life-p.t)/.6):1;
    dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(p.rx,p.ry,0);dummy.scale.setScalar(p.s*sc);dummy.updateMatrix();debris.setMatrixAt(i,dummy.matrix);debris.setColorAt(i,p.c);i++}
  for(let j=D_.length-1;j>=0;j--)if(D_[j].t>D_[j].life)D_.splice(j,1);
  debris.count=i;debris.instanceMatrix.needsUpdate=true;if(i)debris.instanceColor.needsUpdate=true;
  i=0;for(const p of P_){p.t+=dt;p.y+=p.vy*dt;p.x+=p.vx*dt;p.z+=p.vz*dt;const u=p.t/p.life;
    dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(u*2,u*3,0);dummy.scale.setScalar(p.s*(u<.25?.4+u*2.4:1)*(1-u*u));dummy.updateMatrix();puffs.setMatrixAt(i,dummy.matrix);puffs.setColorAt(i,p.c);i++}
  for(let j=P_.length-1;j>=0;j--)if(P_[j].t>P_[j].life)P_.splice(j,1);
  puffs.count=i;puffs.instanceMatrix.needsUpdate=true;if(i)puffs.instanceColor.needsUpdate=true;
}
// transient meshes (fireballs, rings, projectiles)
const FX=[];
function fireball(x,z,r,color=0xffa21f,dur=.7,y=0){
  const m=new THREE.Mesh(new THREE.SphereGeometry(1,20,14),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false}));
  m.position.set(x,y,z);scene.add(m);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.86,1,48),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2;ring.position.set(x,.6,z);scene.add(ring);
  FX.push({t:0,dur,f:u=>{const e=1-(1-u)**3;m.scale.setScalar(r*(.2+e*.9));m.material.opacity=.95*(1-u);ring.scale.setScalar(r*(.3+u*1.9));ring.material.opacity=.8*(1-u)},end:()=>{scene.remove(m,ring);m.geometry.dispose();ring.geometry.dispose()}});
}
const projectiles=[];
function launch(mesh,from,to,dur,arc,onHit,trail){mesh.position.copy(from);scene.add(mesh);projectiles.push({mesh,from:from.clone(),to:to.clone(),t:0,dur,arc,onHit,trail,prev:from.clone()})}
function stepProjectiles(dt){
  for(let i=projectiles.length-1;i>=0;i--){const p=projectiles[i];p.t+=dt;const u=Math.min(1,p.t/p.dur);
    p.prev.copy(p.mesh.position);p.mesh.position.lerpVectors(p.from,p.to,u);p.mesh.position.y+=Math.sin(u*Math.PI)*p.arc;
    const dir=p.mesh.position.clone().sub(p.prev);if(dir.lengthSq()>1e-4){p.mesh.lookAt(p.mesh.position.clone().add(dir))}
    if(p.trail)p.trail(p.mesh.position);
    if(u>=1){scene.remove(p.mesh);projectiles.splice(i,1);p.onHit()}}
}

// ---------- damage / scoring ----------
const collapsing=[];
function hit(k,amt,paint){
  if(!bAlive[k])return 0;
  if(paint){wallC[k].setHex(paint);roofC[k].setHex(paint).multiplyScalar(.9)}
  bHp[k]-=amt;
  if(bHp[k]<=0){kill(k);return 1}
  const d=1-bHp[k]/bMax[k];setL(k,1-d*.28,0,0);paintB(k);return 0;
}
function kill(k){
  bAlive[k]=0;bHp[k]=0;paintB(k);
  const a=Math.random()*Math.PI*2,lean=.25+Math.random()*.35;
  collapsing.push({k,t:0,dur:.8+Math.random()*.6,s0:aL.array[vStart[k]*3],lx:Math.cos(a)*lean,lz:Math.sin(a)*lean});
  const n=Math.min(40,6+bR[k]*.7|0);spawnDebris(bX[k],bH[k],bZ[k],wallC[k],n,18+bR[k]*.4);spawnPuff(bX[k],2,bZ[k],0xb8b0a2,4+bR[k]*.35,4,6);
  const now=performance.now()/1000;combo=now-lastKill<2.2?Math.min(8,combo+1):1;lastKill=now;
  const pts=Math.round(bMax[k]*(bS[k]?5:1)*combo/10)*10;score+=pts;
  if(bS[k]||$('#pops').childElementCount<14)popAt(bX[k],bH[k]+6,bZ[k],(bS[k]&&bName[k]?bName[k]+'  ':'')+'+'+pts.toLocaleString(),bS[k]);
  hudDirty=true;
}
function blast(x,z,r,dmg,paint){let kills=0;
  if(!paint)blastTrees(x,z,r*.8);
  for(let k=0;k<nB;k++){if(!bAlive[k])continue;const d=Math.hypot(bX[k]-x,bZ[k]-z)-bR[k]*.6;if(d<r){const f=1-Math.max(0,d)/r;
    kills+=hit(k,dmg*(.3+.7*f),paint?PAINTS[(Math.random()*PAINTS.length)|0]:0)}}
  return kills;
}
function hud(){
  let ri=0;for(let i=0;i<RANKS.length;i++)if(score>=RANKS[i][1])ri=i;
  $('#rank').textContent=RANKS[ri][0];
  const lo=RANKS[ri][1],hi=RANKS[ri+1]?RANKS[ri+1][1]:lo;$('#bar i').style.width=(hi>lo?(score-lo)/(hi-lo)*100:100)+'%';
  $('#score').textContent=score.toLocaleString();
  let dead=0;for(const k of scadIdx)if(!bAlive[k])dead++;$('#lev').textContent=dead+'/'+scadIdx.length;
  const c=$('#combo');c.textContent='x'+combo;c.style.opacity=combo>1?1:0;
  if(score>best){best=score;$('#best').textContent=best.toLocaleString();try{localStorage.setItem('smashscad.best',best)}catch(e){}}
  if($('#list').classList.contains('open'))renderList();
}
const v3=new THREE.Vector3();
function popAt(x,y,z,text,big){v3.set(x,y,z).project(camera);if(v3.z>1)return;
  const el=document.createElement('div');el.className='pop'+(big?' big':'');el.textContent=text;
  el.style.left=(v3.x*.5+.5)*innerWidth+'px';el.style.top=(-v3.y*.5+.5)*innerHeight+'px';$('#pops').appendChild(el);setTimeout(()=>el.remove(),1400)}

// ---------- camera shake ----------
let shakeAmt=0,hudDirty=false;const shakeOff=new THREE.Vector3();
function shake(a){shakeAmt=Math.min(14,shakeAmt+a)}

// ---------- audio ----------
let AC=null,noiseBuf=null;
function audio(){if(AC)return;try{AC=new (window.AudioContext||window.webkitAudioContext)();noiseBuf=AC.createBuffer(1,AC.sampleRate*2,AC.sampleRate);const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1}catch(e){AC=null}}
function boom(power){if(!AC||muted)return;const t=AC.currentTime;
  const s=AC.createBufferSource();s.buffer=noiseBuf;const f=AC.createBiquadFilter();f.type='lowpass';f.frequency.setValueAtTime(900+power*600,t);f.frequency.exponentialRampToValueAtTime(80,t+.4+power*.5);
  const g=AC.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.5+power*.3,t+.01);g.gain.exponentialRampToValueAtTime(.001,t+.5+power*.9);
  s.connect(f).connect(g).connect(AC.destination);s.start(t);s.stop(t+2);
  const o=AC.createOscillator();o.frequency.setValueAtTime(90,t);o.frequency.exponentialRampToValueAtTime(28,t+.5+power*.3);const og=AC.createGain();og.gain.setValueAtTime(.6,t);og.gain.exponentialRampToValueAtTime(.001,t+.6+power*.5);o.connect(og).connect(AC.destination);o.start(t);o.stop(t+1.5)}
function whoosh(dur,hi=1){if(!AC||muted)return;const t=AC.currentTime;const s=AC.createBufferSource();s.buffer=noiseBuf;const f=AC.createBiquadFilter();f.type='bandpass';f.Q.value=3;
  f.frequency.setValueAtTime(2400*hi,t);f.frequency.exponentialRampToValueAtTime(300,t+dur);const g=AC.createGain();g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(.18,t+dur*.8);g.gain.linearRampToValueAtTime(.001,t+dur);
  s.connect(f).connect(g).connect(AC.destination);s.start(t);s.stop(t+dur+.05)}
function splat(){if(!AC||muted)return;const t=AC.currentTime;const o=AC.createOscillator();o.type='triangle';o.frequency.setValueAtTime(420,t);o.frequency.exponentialRampToValueAtTime(90,t+.18);const g=AC.createGain();g.gain.setValueAtTime(.35,t);g.gain.exponentialRampToValueAtTime(.001,t+.25);o.connect(g).connect(AC.destination);o.start(t);o.stop(t+.3)}

// ---------- weapons ----------
const sky=(p,h,off=0)=>new THREE.Vector3(p.x+off,h,p.z+off*.6);
function fire(p,k){
  const W=WEAPONS.find(w=>w.id==weapon);const now=performance.now()/1000;
  if(cool[weapon]&&now<cool[weapon])return;cool[weapon]=now+W.cd;
  const hy=k>=0?bH[k]:0;const tgt=new THREE.Vector3(p.x,hy*.6,p.z);
  if(weapon=='bomb'){const m=new THREE.Mesh(new THREE.SphereGeometry(3.2,14,10),new THREE.MeshLambertMaterial({color:0x151515}));whoosh(.45);
    launch(m,sky(p,180,10),tgt,.45,0,()=>{fireball(p.x,p.z,30,0xffa21f,.7,hy*.5);spawnPuff(p.x,hy*.5,p.z,0x5a524b,6,6,10);blast(p.x,p.z,30,150);if(k>=0)hit(k,90);boom(.6);shake(3)})}
  if(weapon=='paint'){const c=PAINTS[(Math.random()*PAINTS.length)|0];const m=new THREE.Mesh(new THREE.SphereGeometry(3,14,10),new THREE.MeshLambertMaterial({color:c}));whoosh(.5,1.3);
    launch(m,sky(p,150,-30),tgt,.5,30,()=>{fireball(p.x,p.z,26,c,.6,hy*.5);for(let i=0;i<4;i++)spawnPuff(p.x,hy*.4,p.z,PAINTS[i*2%PAINTS.length],5,3,7);
      for(let i=0;i<20;i++)spawnDebris(p.x,hy,p.z,new THREE.Color(PAINTS[i%PAINTS.length]),1,26);blast(p.x,p.z,42,55,true);splat();shake(1.5)})}
  if(weapon=='pencil'){const g=new THREE.Group();const body=new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.4,26,6),new THREE.MeshLambertMaterial({color:0xffd21f}));body.rotation.x=Math.PI/2;
    const tip=new THREE.Mesh(new THREE.ConeGeometry(1.4,6,6),new THREE.MeshLambertMaterial({color:0xe8c9a0}));tip.rotation.x=Math.PI/2;tip.position.z=16;
    const lead=new THREE.Mesh(new THREE.ConeGeometry(.5,2.2,6),new THREE.MeshLambertMaterial({color:0x222222}));lead.rotation.x=Math.PI/2;lead.position.z=19.6;
    const er=new THREE.Mesh(new THREE.CylinderGeometry(1.45,1.45,3.5,6),new THREE.MeshLambertMaterial({color:0xff7ab0}));er.rotation.x=Math.PI/2;er.position.z=-14.5;g.add(body,tip,lead,er);
    const from=camera.position.clone();from.y=Math.max(from.y*.6,60);const dir=new THREE.Vector3(p.x-from.x,0,p.z-from.z).normalize();whoosh(.55,1.6);
    launch(g,from,tgt,.55,25,()=>{const x2=p.x+dir.x*150,z2=p.z+dir.z*150;
      for(let s=0;s<=15;s++){const x=p.x+dir.x*s*10,z=p.z+dir.z*s*10;spawnPuff(x,4,z,0xd9cdb6,3,1,4)}
      for(let j=0;j<nB;j++){if(!bAlive[j])continue;const t=Math.max(0,Math.min(1,((bX[j]-p.x)*dir.x+(bZ[j]-p.z)*dir.z)/150));const dx=p.x+dir.x*150*t-bX[j],dz=p.z+dir.z*150*t-bZ[j];
        if(Math.hypot(dx,dz)<7+bR[j]*.6)hit(j,260*(1-t*.5))}
      if(k>=0)hit(k,200);fireball(p.x,p.z,12,0xfff1b0,.4,hy*.5);boom(.3);shake(2)})}
  if(weapon=='meteor'){const m=new THREE.Mesh(new THREE.DodecahedronGeometry(11,0),new THREE.MeshLambertMaterial({color:0x4a3b33,emissive:0xff5a1f,emissiveIntensity:.6}));whoosh(1.3,.6);
    launch(m,sky(p,900,-520),new THREE.Vector3(p.x,0,p.z),1.3,0,()=>{fireball(p.x,p.z,85,0xff7a1f,1.1);fireball(p.x,p.z,50,0xfff0a0,.6);spawnPuff(p.x,0,p.z,0x4d4640,22,14,16);blast(p.x,p.z,85,520);boom(1.4);shake(9)},
      pos=>{if(Math.random()<.7)spawnPuff(pos.x,pos.y,pos.z,Math.random()<.5?0xff8a2a:0x6b6158,6,1,2)})}
  if(weapon=='quake'){quake={x:p.x,z:p.z,t:0,next:0};boom(1)}
  if(weapon=='nuke'){const g=new THREE.Group();const b=new THREE.Mesh(new THREE.CylinderGeometry(4,4,20,12),new THREE.MeshLambertMaterial({color:0x3c4a3a}));b.rotation.x=Math.PI/2;
    const n=new THREE.Mesh(new THREE.SphereGeometry(4,12,8),new THREE.MeshLambertMaterial({color:0x3c4a3a}));n.position.z=10;g.add(b,n);whoosh(2,.5);
    launch(g,sky(p,1400,0),new THREE.Vector3(p.x,0,p.z),2,0,()=>{const fl=$('#flash');fl.style.transition='none';fl.style.opacity=1;requestAnimationFrame(()=>{fl.style.transition='opacity 1.6s';fl.style.opacity=0});
      fireball(p.x,p.z,320,0xff8a1f,2.2);fireball(p.x,p.z,160,0xfff6c0,1.2,30);
      const stem=new THREE.Mesh(new THREE.CylinderGeometry(30,55,1,20),new THREE.MeshLambertMaterial({color:0x8b7d70,transparent:true}));const cap=new THREE.Mesh(new THREE.SphereGeometry(1,20,14),new THREE.MeshLambertMaterial({color:0xa0806a,emissive:0x802a00,emissiveIntensity:.5,transparent:true}));
      stem.position.set(p.x,0,p.z);cap.position.set(p.x,0,p.z);scene.add(stem,cap);
      FX.push({t:0,dur:6,f:u=>{const e=1-(1-Math.min(1,u*2.2))**3;const H=380*e;stem.scale.y=H;stem.position.y=H/2;cap.position.y=H;cap.scale.set(90+e*70,(50+e*30),90+e*70);const o=u>.6?1-(u-.6)/.4:1;stem.material.opacity=o;cap.material.opacity=o;cap.material.emissiveIntensity=.6*(1-u)},end:()=>{scene.remove(stem,cap)}});
      blast(p.x,p.z,320,4000);spawnPuff(p.x,0,p.z,0x6d655c,40,24,22);boom(2.5);shake(14)})}
}
let quake=null;
function stepQuake(dt){if(!quake)return;quake.t+=dt;shake(dt*30);
  if(quake.t>=quake.next){quake.next+=.16;const R=480;
    for(let k=0;k<nB;k++){if(!bAlive[k])continue;const d=Math.hypot(bX[k]-quake.x,bZ[k]-quake.z);if(d<R&&Math.random()<.35){hit(k,(14+Math.random()*30)*(1-d/R*.6));if(Math.random()<.15)spawnPuff(bX[k],1,bZ[k],0xc2b8a6,3+bR[k]*.2,1,3)}}
    if(Math.random()<.5)boom(.25)}
  if(quake.t>4.2)quake=null}

// ---------- input ----------
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),gplane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
let down=null,pointers=0;
canvas.addEventListener('pointerdown',e=>{pointers++;down=pointers==1?{x:e.clientX,y:e.clientY,t:performance.now(),b:e.button}:null});
addEventListener('pointerup',e=>{pointers=Math.max(0,pointers-1);if(!down||!ready)return;const d=down;down=null;
  if(e.target!==canvas||d.b!==0||Math.hypot(e.clientX-d.x,e.clientY-d.y)>9||performance.now()-d.t>450)return;
  const r=pickAt(e.clientX,e.clientY);if(!r)return;
  audio();fire(r.pt,r.k);hideHint()});
function pickAt(cx,cy){
  ndc.set(cx/innerWidth*2-1,-(cy/innerHeight)*2+1);ray.setFromCamera(ndc,camera);
  let k=-1;const pt=new THREE.Vector3();const hits=ray.intersectObject(city,false);
  for(const h of hits){const b=faceB[h.faceIndex];if(bAlive[b]){k=b;pt.copy(h.point);break}}
  if(k<0&&!ray.ray.intersectPlane(gplane,pt))return null;
  return {k,pt}}
addEventListener('pointercancel',()=>{pointers=0;down=null});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
let hintT=0;function hideHint(){if(++hintT==3)$('#hint').style.opacity=0}

// ---------- UI ----------
$('#dock').innerHTML=WEAPONS.map(w=>`<button class="wp${w.id==weapon?' on':''}" data-w="${w.id}" aria-label="${w.name}"><svg viewBox="0 0 24 24">${ICON[w.id]}</svg>${w.name}<i class="cd"></i></button>`).join('');
$('#dock').addEventListener('click',e=>{const b=e.target.closest('.wp');if(!b)return;weapon=b.dataset.w;document.querySelectorAll('.wp').forEach(x=>x.classList.toggle('on',x===b));audio()});
function centerOf(names){let x=0,z=0,n=0;for(const nm of names){const k=bName.indexOf(nm);if(k>=0){x+=bX[k];z+=bZ[k];n++}}return n?{x:x/n,z:z/n}:null}
let fly=null;
function flyTo(x,z,dist=420){const off=camera.position.clone().sub(controls.target).setLength(dist);fly={t:0,from:controls.target.clone(),to:new THREE.Vector3(x,0,z),cf:camera.position.clone(),off}}
$('#zones').innerHTML=ZONES.map((z,i)=>`<button data-z="${i}">${z[0]}</button>`).join('');
$('#zones').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const c=centerOf(ZONES[+b.dataset.z][1]);if(c)flyTo(c.x,c.z)});
function renderList(){const q=$('#q').value.trim().toLowerCase();
  const items=scadIdx.filter(k=>bName[k]).map(k=>[bName[k],k]).sort((a,b)=>a[0].localeCompare(b[0])).filter(a=>!q||a[0].toLowerCase().includes(q));
  $('#bl').innerHTML=items.length?items.map(([n,k])=>`<button data-k="${k}" class="${bAlive[k]?'':'dead'}"><span>${n.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</span><em>${bAlive[k]?Math.round(bHp[k]/bMax[k]*100)+'%':'leveled'}</em></button>`).join(''):'<p style="color:var(--mut)">No SCAD building matches that.</p>'}
$('#lsb').onclick=()=>{renderList();$('#list').classList.add('open')};
$('#lsx').onclick=()=>$('#list').classList.remove('open');
$('#q').oninput=renderList;
$('#bl').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const k=+b.dataset.k;flyTo(bX[k],bZ[k],220);if(innerWidth<700)$('#list').classList.remove('open')});
$('#snd').onclick=()=>{muted=!muted;$('#wave').style.display=muted?'none':'';audio()};
$('#rst').onclick=()=>{for(let k=0;k<nB;k++){bAlive[k]=1;bHp[k]=bMax[k];wallC[k].copy(baseW[k]);roofC[k].copy(baseR[k]);setL(k,1,0,0);paintB(k)}
  resetTrees();collapsing.length=0;D_.length=0;P_.length=0;quake=null;score=0;combo=1;hud()};
$('#go').onclick=()=>{$('#intro').style.display='none';audio()};

// ---------- loop ----------
let last=performance.now();
function loop(now){requestAnimationFrame(loop);const f0=performance.now();const dt=Math.min(.05,(now-last)/1000);last=now;
  camera.position.sub(shakeOff);
  if(fly){fly.t+=dt/1.1;const u=Math.min(1,fly.t),e=u<.5?2*u*u:1-(-2*u+2)**2/2;controls.target.lerpVectors(fly.from,fly.to,e);camera.position.copy(controls.target).add(fly.off);if(u>=1)fly=null}
  controls.target.x=Math.max(-1800,Math.min(1300,controls.target.x));controls.target.z=Math.max(-1500,Math.min(3400,controls.target.z));controls.target.y=0;
  controls.update();
  shakeAmt*=Math.pow(.02,dt);shakeOff.set((Math.random()-.5)*shakeAmt,(Math.random()-.5)*shakeAmt*.6,(Math.random()-.5)*shakeAmt);camera.position.add(shakeOff);
  for(let i=collapsing.length-1;i>=0;i--){const c=collapsing[i];c.t+=dt;const u=Math.min(1,c.t/c.dur),e=u*u;setL(c.k,c.s0+(.03-c.s0)*e,c.lx*Math.sin(u*Math.PI)*.6,c.lz*Math.sin(u*Math.PI)*.6);
    if(Math.random()<.4)spawnPuff(bX[c.k],1,bZ[c.k],0xbdb3a3,3+bR[c.k]*.25,1,5);if(u>=1)collapsing.splice(i,1)}
  for(let i=FX.length-1;i>=0;i--){const f=FX[i];f.t+=dt;const u=Math.min(1,f.t/f.dur);f.f(u);if(u>=1){f.end();FX.splice(i,1)}}
  if(geo){stepProjectiles(dt);stepQuake(dt);stepParticles(dt);flushAttrs()}
  const t=now/1000;for(const b of document.querySelectorAll('.wp')){const w=WEAPONS.find(x=>x.id==b.dataset.w);const rem=(cool[w.id]||0)-t;b.classList.toggle('wait',rem>0);b.querySelector('.cd').style.width=rem>0&&w.cd?rem/w.cd*100+'%':'0'}
  if(hudDirty){hudDirty=false;hud()}
  if(combo>1&&t-lastKill>2.2){combo=1;$('#combo').style.opacity=0}
  const f1=performance.now();renderer.render(scene,camera);
  if(PERF){const f2=performance.now();if(frRec)FR.push([now,f1-f0,f2-f1]);if(geo&&!PT.firstRender){renderer.getContext().readPixels(0,0,1,1,6408,5121,new Uint8Array(4));PT.firstRender=performance.now();PT.firstRenderCall=f2-f1}}}
requestAnimationFrame(loop);

PT.fetchStart=performance.now();
fetch(import.meta.env.BASE_URL+'scad-savannah.json').then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}).then(D=>{
  PT.fetched=performance.now();buildGroundLayers(D);PT.ground=performance.now();const st=buildCity(D);PT.city=performance.now();hud();
  const c=centerOf(ZONES[0][1]);if(c){controls.target.set(c.x,0,c.z);camera.position.set(c.x+250,320,c.z+400)}
  ready=true;const g=$('#go');g.disabled=false;g.textContent='Start smashing';
  $('#load').textContent=nB.toLocaleString()+' buildings, '+scadIdx.length+' SCAD · '+st.shaped+' mapped roof shapes · heights: '+st.tagged+' mapped, '+st.lidar.toLocaleString()+' from lidar'+(D.t?' · '+D.t.length+' trees':'');
  if(PERF)window.__smash={PT,FR,rec(on){frRec=on;if(on)FR.length=0},
    pick(cx,cy){const t=performance.now();const r=pickAt(cx,cy);return {ms:performance.now()-t,k:r?r.k:-2}},
    fireAt(id,x,z){weapon=id;cool[id]=0;fire(new THREE.Vector3(x,0,z),-1)},
    target(){return {x:controls.target.x,z:controls.target.z}},
    info(){const r=renderer.info.render;return {calls:r.calls,triangles:r.triangles,verts:geo.attributes.position.count,tiles:tiles.length}},
    alive(){let n=0;for(let k=0;k<nB;k++)n+=bAlive[k];return n},nB:()=>nB,
    // upload micro-benchmark: re-dirty nb buildings per frame, draw one triangle of the city into a 128x80 canvas
    // (so vertex shading and rasterising cost ~nothing) and wait for the GPU. What is left is mostly the attribute upload.
    bench(nb,frames=30,near=false){const sz=new THREE.Vector2();renderer.getSize(sz);renderer.setSize(128,80,false);geo.setDrawRange(0,3);for(const t of tiles)t.m.visible=false;scene.add(city);const gl=renderer.getContext(),px=new Uint8Array(4);
      let ks=[];if(near){const t=controls.target;ks=[...Array(nB).keys()].sort((a,b)=>Math.hypot(bX[a]-t.x,bZ[a]-t.z)-Math.hypot(bX[b]-t.x,bZ[b]-t.z)).slice(0,nb)}
      else for(let k=0;k<nB&&ks.length<nb;k+=Math.max(1,(nB/nb)|0))ks.push(k);const t=[];
      for(let f=0;f<frames+2;f++){for(const k of ks){setL(k,aL.array[vStart[k]*3],aL.array[vStart[k]*3+1],aL.array[vStart[k]*3+2]);paintB(k)}
        const t0=performance.now();flushAttrs();renderer.render(scene,camera);gl.readPixels(0,0,1,1,6408,5121,px);if(f>1)t.push(performance.now()-t0)}
      geo.setDrawRange(0,Infinity);scene.remove(city);for(const t of tiles)t.m.visible=true;renderer.setSize(sz.x,sz.y,false);t.sort((a,b)=>a-b);return t[t.length>>1]},
    hitK(k,amt,paint){return hit(k,amt,paint)},
    particleTest(){const t=controls.target;spawnDebris(t.x,40,t.z,new THREE.Color(0x00ff00),80,0);spawnPuff(t.x+60,30,t.z,0xff00ff,12,12,0)},
    dmg(){let d=0;for(let k=0;k<nB;k++)d+=bMax[k]-Math.max(0,bHp[k]);return d}};
}).catch(err=>{$('#go').textContent='Map failed to load';$('#load').textContent='Could not load the campus data ('+err.message+'). Reload to try again.'});
