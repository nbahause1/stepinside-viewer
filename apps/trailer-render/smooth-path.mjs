// Smooths the trailer camera path: re-samples the spline-through-scout-points
// into many keyframes at CONSTANT SPEED (equal arc-length per equal time), so the
// camera no longer decelerates at each waypoint (the periodic micro-judders).
// Reads settings.trailer.json (the 5 authored points) -> writes
// settings.trailer.smooth.json (dense, constant-velocity) which render.mjs prefers.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// --- CubicSpline ported verbatim from apps/viewer/src/core/spline.ts ---
class CubicSpline {
  constructor(times, knots) { this.times = times; this.knots = knots; this.dim = knots.length / times.length / 3; }
  evaluate(time, result) {
    const { times } = this; const last = times.length - 1;
    if (time <= times[0]) this.getKnot(0, result);
    else if (time >= times[last]) this.getKnot(last, result);
    else { let seg = 0; while (time >= times[seg + 1]) seg++; this.evaluateSegment(seg, (time - times[seg]) / (times[seg + 1] - times[seg]), result); }
  }
  getKnot(index, result) { const { knots, dim } = this; const idx = index * 3 * dim; for (let i = 0; i < dim; ++i) result[i] = knots[idx + i * 3 + 1]; }
  evaluateSegment(segment, t, result) {
    const { knots, dim } = this; const t2 = t * t; const twot = t + t; const omt = 1 - t; const omt2 = omt * omt;
    let idx = segment * dim * 3;
    for (let i = 0; i < dim; ++i) {
      const p0 = knots[idx + 1], m0 = knots[idx + 2], m1 = knots[idx + dim * 3], p1 = knots[idx + dim * 3 + 1]; idx += 3;
      result[i] = p0 * ((1 + twot) * omt2) + m0 * (t * omt2) + p1 * (t2 * (3 - twot)) + m1 * (t2 * (t - 1));
    }
  }
  static calcKnots(times, points, smoothness) {
    const n = times.length, dim = points.length / n, knots = new Array(n * dim * 3);
    for (let i = 0; i < n; i++) {
      const t = times[i];
      for (let j = 0; j < dim; j++) {
        const idx = i * dim + j, p = points[idx];
        let tangent;
        if (i === 0) tangent = (points[idx + dim] - p) / (times[i + 1] - t);
        else if (i === n - 1) tangent = (p - points[idx - dim]) / (t - times[i - 1]);
        else tangent = (points[idx + dim] - points[idx - dim]) / (times[i + 1] - times[i - 1]);
        const inScale = i > 0 ? (times[i] - times[i - 1]) : (times[1] - times[0]);
        const outScale = i < n - 1 ? (times[i + 1] - times[i]) : (times[i] - times[i - 1]);
        knots[idx * 3] = tangent * inScale * smoothness; knots[idx * 3 + 1] = p; knots[idx * 3 + 2] = tangent * outScale * smoothness;
      }
    }
    return knots;
  }
  static fromPoints(times, points, smoothness = 1) { return new CubicSpline(times, CubicSpline.calcKnots(times, points, smoothness)); }
  static fromPointsLooping(length, times, points, smoothness = 1) {
    if (times.length < 2) return CubicSpline.fromPoints(times, points);
    const dim = points.length / times.length; const newTimes = times.slice(); const newPoints = points.slice();
    newTimes.push(length + times[0], length + times[1]); newPoints.push(...points.slice(0, dim * 2));
    newTimes.splice(0, 0, times[times.length - 2] - length, times[times.length - 1] - length);
    newPoints.splice(0, 0, ...points.slice(points.length - dim * 2));
    return CubicSpline.fromPoints(newTimes, newPoints, smoothness);
  }
}

const VIEWER_DIR = path.resolve('..', 'website', 'public', 'viewer');
const base = JSON.parse(readFileSync(path.join(VIEWER_DIR, 'settings.trailer.json'), 'utf8'));
const tr = base.animTracks[0];
const { times, values } = tr.keyframes;
const { position, target, fov } = values;
const frameRate = tr.frameRate || 1;
const duration = tr.duration;
const smoothness = tr.smoothness ?? 1;

// Build the SAME spline the engine builds (AnimState.fromTrack).
const points = [];
for (let i = 0; i < times.length; i++) {
  points.push(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
  points.push(target[i * 3], target[i * 3 + 1], target[i * 3 + 2]);
  points.push(fov[i]);
}
const extra = (duration === times[times.length - 1] / frameRate) ? 1 : 0;
const spline = CubicSpline.fromPointsLooping((duration + extra) * frameRate, times, points, smoothness);

// Dense sample over [0, duration].
const M = 4000;
const samples = [];
for (let k = 0; k < M; k++) { const t = (k / (M - 1)) * duration; const r = []; spline.evaluate(t * frameRate, r); samples.push(r); }

// Cumulative arc length on camera POSITION.
const cum = [0];
for (let k = 1; k < M; k++) { const a = samples[k], b = samples[k - 1]; cum.push(cum[k - 1] + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
const L = cum[M - 1];

// Resample N points at EQUAL arc-length, with EVEN times -> constant speed.
const N = 180;
const round = n => Math.round(n * 1000) / 1000;
const outPos = [], outTgt = [], outFov = [], outTimes = [];
let seg = 0;
for (let i = 0; i < N; i++) {
  const s = (i / (N - 1)) * L;
  while (seg < M - 2 && cum[seg + 1] < s) seg++;
  const s0 = cum[seg], s1 = cum[seg + 1];
  const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
  const a = samples[seg], b = samples[seg + 1];
  const lp = (x, y) => x + (y - x) * f;
  outPos.push(round(lp(a[0], b[0])), round(lp(a[1], b[1])), round(lp(a[2], b[2])));
  outTgt.push(round(lp(a[3], b[3])), round(lp(a[4], b[4])), round(lp(a[5], b[5])));
  outFov.push(round(lp(a[6], b[6])));
  outTimes.push(round((i / (N - 1)) * duration));
}

const out = JSON.parse(JSON.stringify(base));
out.animTracks[0] = {
  name: 'trailer-smooth', duration, frameRate, loopMode: tr.loopMode,
  interpolation: 'spline', smoothness: 0.5,
  keyframes: { times: outTimes, values: { position: outPos, target: outTgt, fov: outFov } }
};
writeFileSync(path.join(VIEWER_DIR, 'settings.trailer.smooth.json'), JSON.stringify(out));
console.log(`Wrote settings.trailer.smooth.json: ${N} constant-speed keyframes, path length ${L.toFixed(2)}m over ${duration}s.`);
