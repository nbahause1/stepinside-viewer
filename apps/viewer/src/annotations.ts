import { Entity, Vec3 } from 'playcanvas';

import { Annotation } from './annotation';
import type { Annotation as AnnotationSettings } from './settings';
import type { Global } from './types';

class Annotations {
    annotations: AnnotationSettings[];

    parentDom: HTMLElement;

    constructor(global: Global, hasCameraFrame: boolean) {
        // create dom parent
        const parentDom = document.createElement('div');
        parentDom.id = 'annotations';
        Annotation.parentDom = parentDom;
        document.querySelector('#ui').appendChild(parentDom);

        this.annotations = global.settings.annotations;
        this.parentDom = parentDom;

        const markersMode = global.settings.annotationMarkers;
        Annotation.markersHidden = markersMode === 'hidden';

        const { state } = global;

        const updateVisibility = () => {
            // 'overview': the numbered bubbles live only in the bird's-eye view
            // and the guided tour — the walking view stays clean. Tooltips via
            // the ‹ › navigator keep working in every mode.
            if (markersMode === 'overview') {
                Annotation.markersHidden =
                    state.cameraMode !== 'aerial' && state.cameraMode !== 'anim';
            }
            const firstPersonGamingControls = (
                (state.cameraMode === 'walk' || state.cameraMode === 'fly') &&
                state.gamingControls
            );
            const hidden = state.controlsHidden || firstPersonGamingControls;
            parentDom.style.display = hidden ? 'none' : 'block';
            Annotation.opacity = hidden ? 0.0 : 1.0;
            if (this.annotations.length > 0) {
                global.app.renderNextFrame = true;
            }
        };

        global.events.on('controlsHidden:changed', updateVisibility);
        global.events.on('cameraMode:changed', updateVisibility);
        global.events.on('gamingControls:changed', updateVisibility);
        updateVisibility();

        if (hasCameraFrame) {
            Annotation.hotspotColor.gamma();
            Annotation.hoverColor.gamma();
        }

        // create annotation entities
        const parent = global.app.root;
        const scriptMap = new Map<AnnotationSettings, Annotation>();

        for (let i = 0; i < this.annotations.length; i++) {
            const ann = this.annotations[i];

            const entity = new Entity();
            entity.addComponent('script');
            entity.script.create(Annotation);
            const script = entity.script as any;
            script.annotation.label = (i + 1).toString();
            script.annotation.title = ann.title;
            script.annotation.text = ann.text;

            entity.setPosition(ann.position[0], ann.position[1], ann.position[2]);

            parent.addChild(entity);

            scriptMap.set(ann, script.annotation);

            // handle an annotation being activated/shown
            script.annotation.on('show', () => {
                global.events.fire('annotation.activate', ann);
                // the active highlight's anchor dot flips on (sheet layout) —
                // the navigator doesn't move the camera, so force one frame
                global.app.renderNextFrame = true;
            });

            script.annotation.on('hide', () => {
                global.events.fire('annotation.deactivate');
                // ...and off again when the highlight closes
                global.app.renderNextFrame = true;
            });

            // re-render if hover state changes
            script.annotation.on('hover', (hover: boolean) => {
                global.app.renderNextFrame = true;
            });
        }

        // handle navigator requesting an annotation to be shown
        global.events.on('annotation.navigate', (ann: AnnotationSettings) => {
            const script = scriptMap.get(ann);
            if (script) {
                script.showTooltip();
                // browsing to another highlight: repaint so the previous dot
                // clears and the new one appears in the same frame
                global.app.renderNextFrame = true;
            }
        });

        // --- guided-tour fly-by reveal -----------------------------------
        // While the tour ("Rundgang") flies the scene, the text bubble of the
        // annotation the camera passes fades in near the point and fades out
        // again as the camera leaves (the shared tooltip's 0.2s opacity
        // transition does the animating). Display-only via the passive
        // tooltip methods — no events, so the tour keeps flying.
        //
        // Three rules keep it calm:
        //   - hysteresis (NEAR < FAR) prevents flicker at the boundary,
        //   - a bubble never stays longer than MAX_MS even when the path
        //     lingers nearby (the demo track circles the parquet for ~18 s),
        //   - each annotation reveals at most once per tour run (reset on
        //     'tour:start'), so a winding path can't re-pop old bubbles.
        // Sight is the primary criterion; distance only rules out reveals from
        // clear across the flat. Generous on purpose — measured on the demo
        // track: floor points (parquet) drop below the frame before the
        // camera gets close, and the Flügeltür is only ever nicely framed
        // from ~6 m while the path approaches it.
        const TOUR_REVEAL_NEAR_M = 6.5;
        const TOUR_REVEAL_FAR_M = 7.5;
        const TOUR_REVEAL_MAX_MS = 6000;
        // trigger only when the point is INSIDE the view (6% inset from every
        // edge) — a bubble for something the visitor can't see is noise.
        // While showing, a small outset keeps it up until the point actually
        // leaves the screen. The first moments of the tour are grace time:
        // the camera is still flying its entry transition there.
        const TOUR_REVEAL_ENTER_INSET = 0.06;
        const TOUR_REVEAL_GRACE_S = 1.5;
        let tourReveal: Annotation | null = null;
        let tourRevealShownAt = 0;
        const tourRevealDone = new Set<Annotation>();
        const tmpViewPos = new Vec3();
        const tmpScreenPos = new Vec3();

        // In the camera's sight field: in front of the camera and projected
        // inside the viewport, inset by `margin` (fraction of each dimension;
        // negative = allow slightly off-screen).
        const inView = (script: Annotation, margin: number): boolean => {
            const cam = global.camera.camera;
            if (!cam) return false;
            const pos = script.entity.getPosition();
            cam.viewMatrix.transformPoint(pos, tmpViewPos);
            if (tmpViewPos.z >= 0) return false;
            const s = cam.worldToScreen(pos, tmpScreenPos);
            const w = window.innerWidth;
            const h = window.innerHeight;
            return s.x > w * margin && s.x < w * (1 - margin) &&
                   s.y > h * margin && s.y < h * (1 - margin);
        };

        const hideTourReveal = () => {
            if (tourReveal) {
                tourReveal.hideTooltipPassive();
                tourReveal = null;
            }
            // resume normal tour speed (camera-manager eases back up)
            state.tourRevealActive = false;
        };

        global.events.on('tour:start', () => {
            tourRevealDone.clear();
        });

        global.app.on('update', () => {
            if (state.cameraMode !== 'anim') {
                hideTourReveal();
                tourRevealDone.clear();
                return;
            }
            const camPos = global.camera.getPosition();

            if (tourReveal) {
                // fade out once the camera clearly moved on, looks away, or
                // after the time cap when the path lingers around the point
                const gone = camPos.distance(tourReveal.entity.getPosition()) > TOUR_REVEAL_FAR_M;
                const outOfSight = !inView(tourReveal, -0.05);
                const expired = performance.now() - tourRevealShownAt > TOUR_REVEAL_MAX_MS;
                if (gone || outOfSight || expired) {
                    hideTourReveal();
                }
                return;
            }

            let best: Annotation | null = null;
            let bestDist = Infinity;
            for (const script of scriptMap.values()) {
                if (tourRevealDone.has(script)) continue;
                const d = camPos.distance(script.entity.getPosition());
                if (d < bestDist) {
                    bestDist = d;
                    best = script;
                }
            }
            if (state.animationTime < TOUR_REVEAL_GRACE_S) return;
            if (best && bestDist <= TOUR_REVEAL_NEAR_M && inView(best, TOUR_REVEAL_ENTER_INSET)) {
                tourReveal = best;
                tourRevealShownAt = performance.now();
                tourRevealDone.add(best);
                best.showTooltipPassive();
                // slow the tour down while the bubble is read (camera-manager)
                state.tourRevealActive = true;
            }
        });
    }
}

export { Annotations };
