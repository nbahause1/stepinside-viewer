import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadVoxelCollision } from '../src/collision/voxel-collision.ts';
const rf = globalThis.fetch;
globalThis.fetch = (async (i:any)=>{const u=typeof i==='string'?i:i.url; if(u.startsWith('file:')){const p=fileURLToPath(u);return{ok:true,statusText:'OK',json:async()=>JSON.parse(readFileSync(p,'utf8')),arrayBuffer:async()=>{const b=readFileSync(p);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}} as any;} return rf(i);}) as typeof fetch;
const path = resolve(process.argv[2]);
const meta = JSON.parse(readFileSync(path,'utf8'));
const c:any = await loadVoxelCollision(pathToFileURL(path).href);
const g = meta.gridBounds;
const y = g.min[1] + (g.max[1]-g.min[1])*0.15;
const probes: [string,number,number][] = [
  ['center',(g.min[0]+g.max[0])/2,(g.min[2]+g.max[2])/2],
  ['corner min',g.min[0]+0.3,g.min[2]+0.3],
  ['corner max',g.max[0]-0.3,g.max[2]-0.3],
  ['edge x-min',g.min[0]+0.3,(g.min[2]+g.max[2])/2],
];
console.log('sampleY=',y.toFixed(2));
for(const [n,x,z] of probes) console.log(`  ${n.padEnd(11)} (${x.toFixed(1)},${z.toFixed(1)}) free=${c.isFreeAt(x,y,z)}`);
let free=0,tot=0; const res=0.2;
for(let x=g.min[0];x<g.max[0];x+=res)for(let z=g.min[2];z<g.max[2];z+=res){tot++;if(c.isFreeAt(x,y,z))free++;}
console.log(`free fraction @${y.toFixed(2)}: ${(100*free/tot).toFixed(0)}% (${free}/${tot})`);
