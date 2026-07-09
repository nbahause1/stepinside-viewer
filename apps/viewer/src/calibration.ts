import { Vec3 } from 'playcanvas';

import type { Global } from './types';

/**
 * Scale verification for the measurement / floor-plan features.
 *
 * The measure tool ([measure.ts]) assumes the scene is metric (1 scene unit = 1
 * metre). That metric scale is baked into the splat + collision at export time
 * (set in the splat editor by matching one real, hand-measured wall). If that
 * step is wrong or forgotten, the viewer confidently shows WRONG measurements —
 * worse than none. This module catches a mis-scaled scan on load.
 *
 * It is pure arithmetic: given an authored reference of known real length
 * (`settings.calibration` = two scene-space points + the real metres they span),
 * it recomputes the distance between the points and compares it to the real
 * length. It does NOT pick, render, or rescale — scale stays baked at export;
 * this only flags a mismatch (console verdict + a `scaleCheck` event a QA badge
 * can listen to). To author the reference, open the scan with `?debug` and use
 * the measure tool — it logs the two endpoints + length ready to paste.
 */

export interface ScaleCheckResult {
    ok: boolean;
    measured: number;   // distance between the reference points, in scene units
    expected: number;   // the known real length, in metres
    deviation: number;  // fractional error (0.03 = 3% off)
    tolerance: number;  // allowed fractional error
}

const verifyScale = (global: Global): ScaleCheckResult | null => {
    const cal = global.settings.calibration;
    if (!cal?.points || cal.points.length !== 2 || typeof cal.meters !== 'number') {
        return null;
    }

    const [pa, pb] = cal.points;
    const measured = new Vec3(pa[0], pa[1], pa[2]).distance(new Vec3(pb[0], pb[1], pb[2]));
    const expected = cal.meters;
    const tolerance = typeof cal.tolerance === 'number' ? cal.tolerance : 0.02;
    const deviation = expected > 0 ? Math.abs(measured - expected) / expected : Infinity;
    const ok = deviation <= tolerance;

    const result: ScaleCheckResult = { ok, measured, expected, deviation, tolerance };
    const pct = (deviation * 100).toFixed(1);

    if (ok) {
        console.log(
            `[scale] OK — reference reads ${measured.toFixed(3)}m vs ${expected}m real ` +
            `(${pct}% off, within ${(tolerance * 100).toFixed(0)}%). Scan is metric; measurements are trustworthy.`
        );
    } else {
        const factor = measured > 0 ? expected / measured : 0;
        console.warn(
            `[scale] MIS-SCALED — reference reads ${measured.toFixed(3)}m but is ${expected}m in reality ` +
            `(${pct}% off). Measurements and floor-plan dimensions will be WRONG. ` +
            `Re-export the splat with its scale multiplied by ${factor.toFixed(4)}.`
        );
    }

    global.events.fire('scaleCheck', result);
    return result;
};

export { verifyScale };
