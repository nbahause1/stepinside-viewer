// Print the vertical point-coverage profile of each long wall as ASCII, so we can
// SEE the windows (gaps at mid/upper height) and calibrate the detector.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const TMP='C:/Users/Hauke/AppData/Local/Temp/claude/C--Users-Hauke/b41ecaa8-1d54-4416-b8bb-8367edb5db20/scratchpad';
const buf=readFileSync(join(TMP,'points.bin')); const P=new Float32Array(buf.buffer,buf.byteOffset,buf.length/4);
const gmin=[Infinity,Infinity,Infinity],gmax=[-Infinity,-Infinity,-Infinity];
for(let i=0;i<P.length;i+=3)for(let c=0;c<3;c++){const v=P[i+c];if(v<gmin[c])gmin[c]=v;if(v>gmax[c])gmax[c]=v;}
const yMin=gmin[1],yMax=gmax[1],NB=Math.round((yMax-yMin)/0.02),yh=new Uint32Array(NB);
for(let i=1;i<P.length;i+=3){const b=Math.floor((P[i]-yMin)/(yMax-yMin)*(NB-1));if(b>=0&&b<NB)yh[b]++;}
let fb=0,fbest=-1;for(let b=0;b<NB*0.4;b++)if(yh[b]>fbest){fbest=yh[b];fb=b;}
const floorY=yMin+(fb+0.5)/NB*(yMax-yMin);
console.log('floorY',floorY.toFixed(2),'X',gmin[0].toFixed(2),gmax[0].toFixed(2),'Z',gmin[2].toFixed(2),gmax[2].toFixed(2));

function profile(name, kind, plane, aMin, aMax){
  const COLW=0.06,HBIN=0.12,HMAX=2.8,NH=Math.round(HMAX/HBIN),nCol=Math.round((aMax-aMin)/COLW);
  const cov=Array.from({length:nCol},()=>new Uint16Array(NH));
  for(let i=0;i<P.length;i+=3){const x=P[i],y=P[i+1],z=P[i+2];
    const perp=kind==='x'?x-plane:z-plane; if(Math.abs(perp)>0.18)continue;
    const along=kind==='x'?z:x; if(along<aMin||along>aMax)continue;
    const hb=Math.floor((y-floorY)/HBIN); if(hb<0||hb>=NH)continue;
    const cb=Math.floor((along-aMin)/COLW); if(cb<0||cb>=nCol)continue; cov[cb][hb]++;
  }
  console.log(`\n=== ${name} (${nCol} cols, height 0..${HMAX}m bottom->top shown top->bottom) ===`);
  for(let h=NH-1;h>=0;h--){let row='';for(let c=0;c<nCol;c++){const v=cov[c][h];row+= v>20?'#':v>4?'+':v>0?'.':' ';}console.log((floorY+(h+0.5)*HBIN-floorY).toFixed(1).padStart(4)+' |'+row+'|');}
}
profile('LEFT wall (windows expected)','x',gmin[0]+0.10,gmin[2],gmax[2]);
profile('RIGHT wall','x',gmax[0]-0.10,gmin[2],gmax[2]);
