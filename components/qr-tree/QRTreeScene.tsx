"use client";

import React, { MutableRefObject, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SEASON_THEMES, type Season, type SeasonTheme } from "./seasonTheme";
import { clamp, hash31, lerp, mulberry32 } from "./hashNoise";

const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const DIR = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Q = new THREE.Quaternion();
const TARGET = new THREE.Vector3();

const TREE_SCALE = 0.56;
const TREE_HEIGHT = 4.0;
const TREE_RADIUS = 2.75;

function smooth(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
function phase(t: number, start: number, end: number) {
  return smooth((t - start) / Math.max(0.0001, end - start));
}
function mixHex(a: string, b: string, t: number) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return `#${ca.lerp(cb, clamp(t, 0, 1)).getHexString()}`;
}

type Leaf = { qrX:number; qrZ:number; treeX:number; treeY:number; treeZ:number; layer:number; scale:number; color:string; rotation:number };
type Branch = { start:[number,number,number]; end:[number,number,number]; radius:number };

function isFinder(r:number,c:number,n:number){
  return (r<7&&c<7)||(r<7&&c>=n-7)||(r>=n-7&&c<7);
}

function buildStructure(matrix:boolean[][],url:string,theme:SeasonTheme){
  const n=matrix.length, mid=(n-1)/2, qrCell=Math.min(0.42,12/n);
  const rnd=mulberry32(hash31(url)^0x6d2b79f5), maxRadius=Math.max(1,Math.hypot(mid,mid));
  const layerMap=Array.from({length:n},()=>Array(n).fill(0));
  const leaves:Leaf[]=[];

  for(let r=0;r<n;r++) for(let c=0;c<n;c++){
    if(!matrix[r][c]) continue;
    let neighbors=0;
    for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
      if(!dr&&!dc) continue;
      const rr=r+dr,cc=c+dc;
      if(rr>=0&&rr<n&&cc>=0&&cc<n&&matrix[rr][cc]) neighbors++;
    }
    const center=1-clamp(Math.hypot(c-mid,r-mid)/maxRadius,0,1);
    const density=neighbors/8;
    const finderPenalty=isFinder(r,c,n)?0.72:1;
    layerMap[r][c]=Math.max(0,Math.min(5,Math.round((center*0.5+density*0.5)*finderPenalty*5)));
  }

  const foliage=theme.foliageColors.length?theme.foliageColors:["#69c73d"];
  for(let r=0;r<n;r++) for(let c=0;c<n;c++){
    if(!matrix[r][c]) continue;
    const dx=c-mid,dz=r-mid,nx=dx/Math.max(1,mid),nz=dz/Math.max(1,mid);
    const radial=clamp(Math.hypot(nx,nz),0,1),angle=Math.atan2(nz,nx);
    const layer=layerMap[r][c],layerT=layer/5;
    const crownRadius=TREE_RADIUS*(0.12+radial*0.88)*(0.90+layerT*0.08);
    const crownX=Math.cos(angle)*crownRadius;
    const crownZ=Math.sin(angle)*crownRadius;
    const crownY=0.95+Math.pow(1-radial,0.72)*TREE_HEIGHT*0.50+layerT*1.25+(rnd()-0.5)*0.12;
    const colorIndex=Math.min(foliage.length-1,Math.round(layerT*(foliage.length-1)));
    const leafScale=qrCell*(0.60+layerT*0.08)*(0.94+rnd()*0.08);
    leaves.push({
      qrX:dx*qrCell,qrZ:dz*qrCell,
      treeX:crownX*TREE_SCALE,treeY:crownY*TREE_SCALE,treeZ:crownZ*TREE_SCALE,
      layer,scale:leafScale*0.68,color:foliage[colorIndex]||"#69c73d",rotation:rnd()*Math.PI*2
    });
  }

  const candidates=leaves.filter(l=>l.layer>=3).sort((a,b)=>b.layer-a.layer||Math.atan2(a.treeZ,a.treeX)-Math.atan2(b.treeZ,b.treeX));
  const branches:Branch[]=[]; const usedAngles:number[]=[];
  for(const leaf of candidates){
    const angle=Math.atan2(leaf.treeZ,leaf.treeX);
    if(usedAngles.some(a=>Math.abs(Math.atan2(Math.sin(a-angle),Math.cos(a-angle)))<0.48)) continue;
    usedAngles.push(angle); if(usedAngles.length>8) break;
    branches.push({start:[0,0.55+(usedAngles.length%3)*0.38,0],end:[leaf.treeX*0.78,Math.max(0.95,leaf.treeY-0.10),leaf.treeZ*0.78],radius:Math.max(0.045,0.09-usedAngles.length*0.005)});
  }
  return {leaves,branches,qrCell,platformSize:6.0};
}

function Ground({size,theme,progressRef}:{size:number;theme:SeasonTheme;progressRef:MutableRefObject<number>}){
  const ref=useRef<THREE.Mesh>(null),rim=useRef<THREE.Mesh>(null);
  useFrame(()=>{
    const p=phase(progressRef.current,0.16,0.72);
    if(ref.current)(ref.current.material as THREE.MeshStandardMaterial).color.set(mixHex("#f7f4ed",theme.stoneTileColors[1]||"#e4ddcc",p));
    if(rim.current)rim.current.visible=p>0.2;
  });
  return <group position={[0,-0.08,0]}>
    <mesh ref={ref} receiveShadow><boxGeometry args={[size,0.12,size]}/><meshStandardMaterial color="#f7f4ed" roughness={0.96}/></mesh>
    <mesh ref={rim} position={[0,-0.06,0]} receiveShadow><boxGeometry args={[size+0.16,0.08,size+0.16]}/><meshStandardMaterial color="#c4bbaa" roughness={0.93}/></mesh>
  </group>;
}

function QRState({matrix,theme,progressRef,qrCell}:{matrix:boolean[][];theme:SeasonTheme;progressRef:MutableRefObject<number>;qrCell:number}){
  const ref=useRef<THREE.InstancedMesh>(null),n=matrix.length,mid=(n-1)/2;
  useFrame(()=>{
    const mesh=ref.current;if(!mesh)return;
    const p=progressRef.current,visible=1-phase(p,0.08,0.58),soften=phase(p,0.12,0.62);
    for(let r=0;r<n;r++)for(let c=0;c<n;c++){
      const i=r*n+c,dark=matrix[r][c],x=(c-mid)*qrCell,z=(r-mid)*qrCell,h=dark?0.08*visible:0.035;
      DUMMY.position.set(x,h*0.5-0.01,z);DUMMY.scale.set(qrCell*0.98,h,qrCell*0.98);DUMMY.rotation.set(0,0,0);DUMMY.updateMatrix();mesh.setMatrixAt(i,DUMMY.matrix);
      const stone=theme.stoneTileColors[1]||"#e4ddcc",darkColor=theme.qrDarkPalette[2]||"#4f9638";
      COLOR.set(dark?darkColor:(theme.qrLightPalette[1]||"#e7dfcf")); if(dark)COLOR.lerp(new THREE.Color(stone),soften);mesh.setColorAt(i,COLOR);
    }
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  });
  return <instancedMesh ref={ref} args={[undefined,undefined,n*n]} receiveShadow><boxGeometry args={[1,1,1]}/><meshStandardMaterial roughness={0.92}/></instancedMesh>;
}

function Leaves({leaves,progressRef}:{leaves:Leaf[];progressRef:MutableRefObject<number>}){
  const ref=useRef<THREE.InstancedMesh>(null);
  useFrame((state)=>{
    const mesh=ref.current;if(!mesh)return;
    const tree=phase(progressRef.current,0.12,0.90),time=state.clock.elapsedTime;
    for(let i=0;i<leaves.length;i++){
      const l=leaves[i],sway=Math.sin(time*1.05+i*0.21)*0.018*tree;
      DUMMY.position.set(lerp(l.qrX,l.treeX,tree),lerp(0.04,l.treeY,tree),lerp(l.qrZ,l.treeZ,tree));
      DUMMY.rotation.set(0.07*Math.sin(time+i),l.rotation+sway,0.07*Math.cos(i*0.7+time));
      DUMMY.scale.setScalar(l.scale*(0.22+0.78*tree));DUMMY.updateMatrix();mesh.setMatrixAt(i,DUMMY.matrix);COLOR.set(l.color);mesh.setColorAt(i,COLOR);
    }
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  });
  return <instancedMesh ref={ref} args={[undefined,undefined,leaves.length]} castShadow receiveShadow><icosahedronGeometry args={[1,0]}/><meshStandardMaterial roughness={0.64} flatShading/></instancedMesh>;
}

function Branches({branches,theme,progressRef}:{branches:Branch[];theme:SeasonTheme;progressRef:MutableRefObject<number>}){
  const ref=useRef<THREE.InstancedMesh>(null),trunk=useRef<THREE.Mesh>(null);
  useFrame(()=>{
    const mesh=ref.current,tree=phase(progressRef.current,0.16,0.72);
    if(mesh){for(let i=0;i<branches.length;i++){const b=branches[i];A.set(b.start[0]*tree,b.start[1]*tree,b.start[2]*tree);B.set(b.end[0]*tree,b.end[1]*tree,b.end[2]*tree);DIR.copy(B).sub(A);const len=DIR.length();if(len<0.001){DUMMY.scale.set(0,0,0);DUMMY.updateMatrix();mesh.setMatrixAt(i,DUMMY.matrix);continue;}DIR.normalize();Q.setFromUnitVectors(UP,DIR);DUMMY.position.copy(A).add(B).multiplyScalar(0.5);DUMMY.quaternion.copy(Q);DUMMY.scale.set(b.radius,len,b.radius);DUMMY.updateMatrix();mesh.setMatrixAt(i,DUMMY.matrix);}mesh.instanceMatrix.needsUpdate=true;}
    if(trunk.current){trunk.current.scale.y=Math.max(0.001,tree);trunk.current.position.y=0.46*tree;}
  });
  return <>
    <mesh ref={trunk} castShadow receiveShadow><cylinderGeometry args={[0.14,0.21,0.92,8]}/><meshStandardMaterial color={theme.trunkColor} roughness={0.82}/></mesh>
    <instancedMesh ref={ref} args={[undefined,undefined,branches.length]} castShadow receiveShadow><cylinderGeometry args={[0.65,1,1,7]}/><meshStandardMaterial color={theme.trunkColor} roughness={0.78}/></instancedMesh>
  </>;
}

function CameraRig({progressRef,qrSpan,userAngleRef}:{progressRef:MutableRefObject<number>;qrSpan:number;userAngleRef:MutableRefObject<{azimuth:number;elevation:number}>}){
  const {camera,size}=useThree();
  useFrame(()=>{
    const p=smooth(progressRef.current),aspect=size.width/Math.max(1,size.height),fov=(34*Math.PI)/180;
    const qrDistance=Math.max(16,(qrSpan*0.74)/Math.tan(fov/2)/Math.max(0.62,aspect));
    const user=userAngleRef.current,azimuth=Math.PI*0.25+user.azimuth,elevation=clamp(0.64+user.elevation,0.40,0.9),treeDistance=18.0;
    const tx=Math.sin(azimuth)*Math.cos(elevation)*treeDistance,ty=Math.sin(elevation)*treeDistance,tz=Math.cos(azimuth)*Math.cos(elevation)*treeDistance;
    camera.position.set(lerp(0,tx,p),lerp(qrDistance,ty,p),lerp(0.001,tz,p));TARGET.set(0,lerp(0,1.0,p),0);camera.up.set(0,1,0);camera.lookAt(TARGET);
  });
  return null;
}

function Lighting({theme,progressRef}:{theme:SeasonTheme;progressRef:MutableRefObject<number>}){
  const light=useRef<THREE.DirectionalLight>(null);
  useFrame(()=>{if(!light.current)return;const p=progressRef.current;light.current.position.set(lerp(0,8,p),17,lerp(0,10,p));light.current.intensity=lerp(1.05,1.4,p);});
  return <><ambientLight color={theme.ambientColor} intensity={1.22}/><directionalLight ref={light} color={theme.sunColor} position={[0,17,0]} intensity={1.1} castShadow shadow-mapSize-width={1536} shadow-mapSize-height={1536}/><hemisphereLight color="#fffaf0" groundColor="#b7aa94" intensity={0.28}/></>;
}

function Scene({matrix,url,season,isFlat,userAngleRef}:{matrix:boolean[][];url:string;season:Season;isFlat:boolean;userAngleRef:MutableRefObject<{azimuth:number;elevation:number}>}){
  const progressRef=useRef(isFlat?0:1),theme=SEASON_THEMES[season],structure=useMemo(()=>buildStructure(matrix,url,theme),[matrix,url,theme]);
  useFrame((_,delta)=>{const target=isFlat?0:1,speed=target>progressRef.current?1.45:1.85;progressRef.current+=(target-progressRef.current)*Math.min(1,delta*speed);if(Math.abs(target-progressRef.current)<0.001)progressRef.current=target;});
  return <><Lighting theme={theme} progressRef={progressRef}/><CameraRig progressRef={progressRef} qrSpan={matrix.length*structure.qrCell} userAngleRef={userAngleRef}/><Ground size={structure.platformSize} theme={theme} progressRef={progressRef}/><QRState matrix={matrix} theme={theme} progressRef={progressRef} qrCell={structure.qrCell}/><Branches branches={structure.branches} theme={theme} progressRef={progressRef}/><Leaves leaves={structure.leaves} progressRef={progressRef}/></>;
}

export interface QRTreeSceneProps{matrix:boolean[][];url:string;season:Season;isFlat:boolean;onToggleFlat:()=>void;className?:string;style?:React.CSSProperties;}

export default function QRTreeScene({matrix,url,season,isFlat,onToggleFlat,className,style}:QRTreeSceneProps){
  const theme=SEASON_THEMES[season],userAngleRef=useRef({azimuth:0,elevation:0}),dragRef=useRef<{startX:number;startY:number;moved:boolean}|null>(null);
  const onPointerDown=(e:React.PointerEvent)=>{if(e.button!==0)return;dragRef.current={startX:e.clientX,startY:e.clientY,moved:false};};
  const onPointerMove=(e:React.PointerEvent)=>{const d=dragRef.current;if(!d)return;const dx=e.clientX-d.startX,dy=e.clientY-d.startY;if(Math.abs(dx)>3||Math.abs(dy)>3){d.moved=true;userAngleRef.current.azimuth+=dx*0.0035;userAngleRef.current.elevation=clamp(userAngleRef.current.elevation-dy*0.003,-0.18,0.28);d.startX=e.clientX;d.startY=e.clientY;}};
  const onPointerUp=()=>{const d=dragRef.current;if(d&&!d.moved)onToggleFlat();dragRef.current=null;};
  return <div className={className} style={{width:"100%",height:"100%",cursor:"grab",touchAction:"none",...style}} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={()=>{dragRef.current=null;}}>
    <Canvas camera={{fov:34,near:0.1,far:180,position:[0,20,0.001]}} dpr={[1,1.75]} gl={{antialias:true,alpha:false,powerPreference:"high-performance"}} shadows style={{background:theme.bgColor}}>
      <color attach="background" args={[theme.bgColor]}/><fog attach="fog" args={[theme.bgColor,42,100]}/><Scene matrix={matrix} url={url} season={season} isFlat={isFlat} userAngleRef={userAngleRef}/>
    </Canvas>
  </div>;
}
