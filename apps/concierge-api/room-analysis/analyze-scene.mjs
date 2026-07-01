// Room analysis v2: floor plan + WINDOW/DOOR detection via vertical wall profiles.
// Caches the decoded point cloud so iteration is fast.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SCENE = 'C:/Users/Hauke/projekte/stepinside-viewer/apps/website/public/viewer/scene';
const TMP = 'C:/Users/Hauke/AppData/Local/Temp/claude/C--Users-Hauke/b41ecaa8-1d54-4416-b8bb-8367edb5db20/scratchpad';
const FF = 'C:/Users/Hauke/projekte/stepinside-viewer/apps/trailer-render/node_modules/ffmpeg-static/ffmpeg.exe';
const OUT_DIR = 'C:/Users/Hauke/projekte/stepinside-viewer/apps/concierge-api/staging-refs/_out';
const CACHE = join(TMP, 'points.bin');

// ---- 1. Point cloud (cached) --------------------------------------------------
let P;   // Float32Array XYZ
if (existsSync(CACHE)) {
  const buf = readFileSync(CACHE);
  P = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  console.log('loaded cache:', P.length / 3, 'points');
} else {
  const decode = webp => { const o = join(TMP, 'dec.raw'); execFileSync(FF, ['-y','-loglevel','error','-i',webp,'-f','rawvideo','-pix_fmt','rgba',o]); return readFileSync(o); };
  const tiles = readdirSync(SCENE).filter(d => /^\d+_\d+$/.test(d));
  const chunks = []; let total = 0;
  for (const t of tiles) {
    const m = JSON.parse(readFileSync(join(SCENE, t, 'meta.json'), 'utf8'));
    const { count } = m, { mins, maxs } = m.means;
    const lo = decode(join(SCENE, t, 'means_l.webp')), hi = decode(join(SCENE, t, 'means_u.webp'));
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) {
      const v = hi[i*4+c]*256 + lo[i*4+c]; a[i*3+c] = mins[c] + v/65535*(maxs[c]-mins[c]);
    }
    chunks.push(a); total += count; process.stdout.write(`  ${t}\r`);
  }
  P = new Float32Array(total * 3); let o = 0;
  for (const a of chunks) { P.set(a, o); o += a.length; }
  writeFileSync(CACHE, Buffer.from(P.buffer));
  console.log('\ndecoded + cached:', total, 'points');
}
const NP = P.length / 3;

// ---- 2. Bounds + floor --------------------------------------------------------
const gmin = [Infinity,Infinity,Infinity], gmax = [-Infinity,-Infinity,-Infinity];
for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) { const v=P[i+c]; if(v<gmin[c])gmin[c]=v; if(v>gmax[c])gmax[c]=v; }
const yMin = gmin[1], yMax = gmax[1], NB = Math.round((yMax-yMin)/0.02);
const yh = new Uint32Array(NB);
for (let i = 1; i < P.length; i += 3) { const b = Math.floor((P[i]-yMin)/(yMax-yMin)*(NB-1)); if(b>=0&&b<NB) yh[b]++; }
let fb=0,fbest=-1; for(let b=0;b<NB*0.4;b++) if(yh[b]>fbest){fbest=yh[b];fb=b;}
const floorY = yMin + (fb+0.5)/NB*(yMax-yMin);

// ---- 3. Top-down occupancy grid ----------------------------------------------
const CELL = 0.03, PAD = 0.05;
const x0 = gmin[0]-PAD, z0 = gmin[2]-PAD, x1 = gmax[0]+PAD, z1 = gmax[2]+PAD;
const W = Math.round((x1-x0)/CELL), H = Math.round((z1-z0)/CELL), N = W*H;
const cellX = (x1-x0)/W, cellZ = (z1-z0)/H, cellArea = cellX*cellZ;
const idx=(x,y)=>y*W+x, inB=(x,y)=>x>=0&&x<W&&y>=0&&y<H, nbr4=[[1,0],[-1,0],[0,1],[0,-1]];
const floorCnt = new Uint32Array(N), wallCnt = new Uint32Array(N);
for (let i = 0; i < P.length; i += 3) {
  const gx=Math.floor((P[i]-x0)/cellX), gz=Math.floor((P[i+2]-z0)/cellZ);
  if(gx<0||gx>=W||gz<0||gz>=H) continue; const p=gz*W+gx; const h=P[i+1]-floorY;
  if(h>=-0.08&&h<=0.12) floorCnt[p]++; else if(h>0.20&&h<1.40) wallCnt[p]++;
}

// ---- 4. Clean -> room / placeable --------------------------------------------
let wall=new Uint8Array(N), floorB=new Uint8Array(N);
for(let p=0;p<N;p++){floorB[p]=floorCnt[p]>1?1:0; wall[p]=wallCnt[p]>3?1:0;}
{ const w2=wall.slice(); for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(wall[idx(x,y)]){let c=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&inB(x+dx,y+dy))c+=wall[idx(x+dx,y+dy)];if(c<2)w2[idx(x,y)]=0;} wall=w2; }
const free=new Uint8Array(N); for(let p=0;p<N;p++) free[p]=(floorB[p]&&!wall[p])?1:0;
const comp=new Int32Array(N).fill(-1); let bId=-1,bSz=0,cid=0;
for(let s=0;s<N;s++) if(free[s]&&comp[s]<0){const st=[s];comp[s]=cid;let sz=0;while(st.length){const p=st.pop();sz++;const x=p%W,y=(p/W)|0;for(const[dx,dy]of nbr4){const nx=x+dx,ny=y+dy;if(inB(nx,ny)){const q=idx(nx,ny);if(free[q]&&comp[q]<0){comp[q]=cid;st.push(q);}}}}if(sz>bSz){bSz=sz;bId=cid;}cid++;}
let room=new Uint8Array(N); for(let p=0;p<N;p++) room[p]=comp[p]===bId?1:0;
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=idx(x,y);if(!room[p]&&!wall[p]){let c=0;for(const[dx,dy]of nbr4)if(inB(x+dx,y+dy)&&room[idx(x+dx,y+dy)])c++;if(c>=3)room[p]=1;}}
const CLR=Math.max(1,Math.round(0.15/CELL)); let place=room.slice();
for(let it=0;it<CLR;it++){const nx=place.slice();for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(place[idx(x,y)])for(const[dx,dy]of nbr4){if(!inB(x+dx,y+dy)||!place[idx(x+dx,y+dy)]){nx[idx(x,y)]=0;break;}}place=nx;}
let rx0=W,rx1=0,rz0=H,rz1=0; for(let p=0;p<N;p++)if(room[p]){const x=p%W,y=(p/W)|0;rx0=Math.min(rx0,x);rx1=Math.max(rx1,x);rz0=Math.min(rz0,y);rz1=Math.max(rz1,y);}
const wLeftX = x0+rx0*cellX, wRightX = x0+rx1*cellX, wNearZ = z0+rz0*cellZ, wFarZ = z0+rz1*cellZ;

// ---- 5. Window/door detection via vertical wall profiles ----------------------
// For a wall plane, bin points near it ALONG the wall and by HEIGHT; a column
// with a tall empty vertical band is an opening; sill present => window, else door.
const COLW = 0.05, HBIN = 0.10, HMAX = 2.4, NH = Math.round(HMAX/HBIN);
function wallProfile(kind, plane, aMin, aMax) {
  // kind 'x': wall at X=plane, along Z (aMin..aMax). 'z': wall at Z=plane, along X.
  const nCol = Math.max(1, Math.round((aMax-aMin)/COLW));
  const cov = Array.from({length:nCol}, ()=>new Uint8Array(NH));
  for (let i=0;i<P.length;i+=3){ const x=P[i],y=P[i+1],z=P[i+2];
    const perp = kind==='x' ? x-plane : z-plane; if (Math.abs(perp)>0.15) continue;
    const along = kind==='x' ? z : x; if (along<aMin||along>aMax) continue;
    const hb = Math.floor((y-floorY)/HBIN); if(hb<0||hb>=NH) continue;
    const cb = Math.floor((along-aMin)/COLW); if(cb<0||cb>=nCol) continue;
    cov[cb][hb]=1;
  }
  // per column: occupied height bins in [0.1 .. 2.2]; sill occ in [0.1..0.5]
  const lo=Math.round(0.1/HBIN), hi=Math.round(2.2/HBIN), sillHi=Math.round(0.5/HBIN);
  const solidBins=[], sill=[];
  for(let c=0;c<nCol;c++){let s=0,sc=0;for(let h=lo;h<hi;h++)s+=cov[c][h];for(let h=lo;h<sillHi;h++)sc+=cov[c][h];solidBins.push(s);sill.push(sc>0);}
  // open column: few occupied bins across the wall height
  const open = solidBins.map(s=>s<=4);
  // group open runs >= 0.4m
  const openings=[]; let st=-1;
  for(let c=0;c<=nCol;c++){ if(c<nCol&&open[c]){ if(st<0)st=c; } else if(st>=0){ const len=(c-st)*COLW; if(len>=0.4){ let sillCnt=0;for(let k=st;k<c;k++)if(sill[k])sillCnt++; openings.push({a0:aMin+st*COLW,a1:aMin+c*COLW,len,type: sillCnt>(c-st)*0.5?'window':'door'}); } st=-1; } }
  return { openings, solidBins };
}
const walls = {
  left:  wallProfile('x', wLeftX,  wNearZ, wFarZ),
  right: wallProfile('x', wRightX, wNearZ, wFarZ),
  near:  wallProfile('z', wNearZ,  wLeftX, wRightX),
  far:   wallProfile('z', wFarZ,   wLeftX, wRightX),
};
const openLen = w => w.openings.reduce((s,o)=>s+o.len,0);
const sofaSide = openLen(walls.left) <= openLen(walls.right) ? 'left' : 'right';

// ---- 6. Render ----------------------------------------------------------------
const rgb=Buffer.alloc(N*3), set=(p,r,g,b)=>{rgb[p*3]=r;rgb[p*3+1]=g;rgb[p*3+2]=b;};
for(let p=0;p<N;p++){ if(wall[p])set(p,45,45,52); else if(place[p])set(p,120,200,130); else if(room[p])set(p,205,220,208); else set(p,255,255,255); }
// paint detected openings (blue=window, red=door) onto their wall line
function paintWall(kind, plane, w){ for(const o of w.openings){ const col = o.type==='window'?[70,140,215]:[210,80,70];
  if(kind==='x'){ const gx=Math.round((plane-x0)/cellX); for(let a=o.a0;a<o.a1;a+=cellZ){const gz=Math.round((a-z0)/cellZ); for(let dx=-1;dx<=1;dx++) if(inB(gx+dx,gz)) set(idx(gx+dx,gz),...col);} }
  else { const gz=Math.round((plane-z0)/cellZ); for(let a=o.a0;a<o.a1;a+=cellX){const gx=Math.round((a-x0)/cellX); for(let dz=-1;dz<=1;dz++) if(inB(gx,gz+dz)) set(idx(gx,gz+dz),...col);} } } }
paintWall('x',wLeftX,walls.left); paintWall('x',wRightX,walls.right); paintWall('z',wNearZ,walls.near); paintWall('z',wFarZ,walls.far);
// suggested sofa wall in orange
for(let y=rz0;y<=rz1;y++){let wx=-1; if(sofaSide==='left'){for(let x=rx0;x<=rx1;x++)if(room[idx(x,y)]){wx=x;break;}}else{for(let x=rx1;x>=rx0;x--)if(room[idx(x,y)]){wx=x;break;}} if(wx>=0)set(idx(wx,y),235,140,40);}
writeFileSync(join(TMP,'map2.rgb'),rgb);
const outPng=join(OUT_DIR,'room-analysis.png');
execFileSync(FF,['-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',`${W}x${H}`,'-i',join(TMP,'map2.rgb'),'-vf','scale=-1:660:flags=neighbor',outPng]);

// ---- 7. Report ----------------------------------------------------------------
let roomA=0,placeA=0; for(let p=0;p<N;p++){roomA+=room[p];placeA+=place[p];}
console.log('\n=== ROOM ANALYSIS v2 ===');
console.log(`footprint: ${((rx1-rx0)*cellX).toFixed(2)} x ${((rz1-rz0)*cellZ).toFixed(2)}  (scan units)`);
console.log(`room area ${(roomA*cellArea).toFixed(1)}  placeable ${(placeA*cellArea).toFixed(1)}`);
for(const [name,w] of Object.entries(walls)) console.log(`  ${name} wall: ${w.openings.map(o=>`${o.type} ${o.len.toFixed(2)}`).join(', ')||'solid'}`);
console.log(`suggested sofa wall: ${sofaSide}`);
console.log('map ->', outPng);
