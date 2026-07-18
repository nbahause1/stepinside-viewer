import {
    type AppBase,
    CULLFACE_NONE,
    FILTER_LINEAR,
    FILTER_LINEAR_MIPMAP_LINEAR,
    PIXELFORMAT_RGBA8,
    BlendState,
    Color,
    Entity,
    Layer,
    Mesh,
    MeshInstance,
    PlaneGeometry,
    Script,
    StandardMaterial,
    Texture,
    type Quat,
    Vec3,
    BLENDEQUATION_ADD,
    BLENDMODE_ONE,
    BLENDMODE_ONE_MINUS_SRC_ALPHA,
    BLENDMODE_SRC_ALPHA
} from 'playcanvas';

// clamp the vertices of the hotspot so it is never clipped by the near or far plane
const depthClampGlsl = `
    float f = gl_Position.z / gl_Position.w;
    if (f > 1.0) {
        gl_Position.z = gl_Position.w;
    } else if (f < -1.0) {
        gl_Position.z = -gl_Position.w;
    }
`;

const depthClampWgsl = `
    let f = output.position.z / output.position.w;
    if (f > 1.0) {
        output.position.z = output.position.w;
    } else if (f < -1.0) {
        output.position.z = -output.position.w;
    }
`;

const vec = new Vec3();
// Scratch for worldToScreen so the per-annotation, per-frame prerender loop
// allocates nothing (was one Vec3 per annotation per frame).
const screenVec = new Vec3();

/**
 * A script for creating interactive 3D annotations in a scene. Each annotation consists of:
 *
 * - A 3D hotspot that maintains constant screen-space size. The hotspot is rendered with muted
 * appearance when obstructed by geometry but is still clickable. The hotspot relies on an
 * invisible DOM element that matches the hotspot's size and position to detect clicks.
 * - An annotation panel that shows title and description text.
 */
export class Annotation extends Script {
    static scriptName = 'annotation';

    static hotspotSize = 25;

    static hotspotColor = new Color(0.8, 0.8, 0.8);

    static hoverColor = new Color(1.0, 0.4, 0.0);

    static parentDom: HTMLElement | null = null;

    static styleSheet: HTMLStyleElement | null = null;

    static camera: Entity | null = null;

    static tooltipDom: HTMLDivElement | null = null;

    static titleDom: HTMLDivElement | null = null;

    static textDom: HTMLDivElement | null = null;

    static layers: Layer[] = [];

    static mesh: Mesh | null = null;

    static activeAnnotation: Annotation | null = null;

    static hoverAnnotation: Annotation | null = null;

    static opacity = 1.0;

    // settings.annotationMarkers === 'hidden': tooltips + navigator stay fully
    // functional but the in-scene number bubbles are never rendered (and their
    // invisible hit zones never accept taps).
    static markersHidden = false;

    /**
     * @attribute
     */
    label: string;

    /**
     * @attribute
     */
    title: string;

    /**
     * @attribute
     */
    text: string;

    /**
     * @private
     */
    hotspotDom: HTMLDivElement | null = null;

    /**
     * @private
     */
    texture: Texture | null = null;

    /**
     * @private
     */
    materials: StandardMaterial[] = [];

    /** Last written marker opacity, so _update skips redundant uniform writes. */
    private _lastMarkerOpacity = -1;

    /** Bound listeners/handlers kept so destroy() can deregister them (leak fix). */
    private _onDocClick: (() => void) | null = null;
    private _onPrerender: (() => void) | null = null;

    /**
     * Injects required CSS styles into the document.
     * @param {number} size - The size of the hotspot in screen pixels.
     * @private
     */
    static _injectStyles(size: number) {
        const css = `
            /* Light frosted-glass card, same recipe as the tutorial cards
               (bright white veil over a saturated blur, glossy top edge, soft
               float shadow) so annotation tooltips share the premium glass
               language of the rest of the viewer chrome. */
            .pc-annotation {
                display: block;
                position: absolute;
                background:
                    radial-gradient(135% 130% at 50% -14%, rgba(255, 255, 255, 0.96), rgba(255, 255, 255, 0) 62%),
                    linear-gradient(180deg, rgba(255, 255, 255, 0.74), rgba(246, 247, 250, 0.56));
                -webkit-backdrop-filter: blur(30px) saturate(180%) brightness(1.08);
                backdrop-filter: blur(30px) saturate(180%) brightness(1.08);
                border: 1px solid rgba(255, 255, 255, 0.68);
                box-shadow:
                    0 12px 30px -12px rgba(0, 0, 0, 0.26),
                    0 30px 60px -28px rgba(0, 0, 0, 0.30),
                    inset 0 1px 0 0 rgba(255, 255, 255, 0.95),
                    inset 0 -1px 0 0 rgba(0, 0, 0, 0.05);
                color: var(--ink-2, rgba(28, 28, 30, 0.62));
                padding: 12px 15px;
                border-radius: 16px;
                font-size: 12.5px;
                font-weight: 500;
                line-height: 1.4;
                font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
                pointer-events: none;
                max-width: min(240px, calc(100vw - 32px));
                word-wrap: break-word;
                overflow-x: visible;
                white-space: normal;
                width: fit-content;
                opacity: 0;
                transition: opacity 0.2s ease-in-out;
                visibility: hidden;
            }

            /* Phone: compact bottom-centre card (see _updatePositions).
               No arrow, a touch tighter, and it may use most of the width. */
            .pc-annotation.sheet {
                max-width: min(300px, calc(100vw - 44px));
                padding: 11px 14px;
            }
            .pc-annotation.sheet::before { display: none; }

            .pc-annotation-title {
                font-size: 14px;
                font-weight: 600;
                letter-spacing: -0.005em;
                color: var(--ink-1, rgba(24, 24, 26, 0.94));
            }

            .pc-annotation-text {
                margin-top: 3px;
            }

            .pc-annotation-text:empty {
                display: none;
            }

            /* Tooltip arrow */
            .pc-annotation.arrow-right::before,
            .pc-annotation.arrow-left::before {
                content: "";
                position: absolute;
                top: var(--arrow-top, 50%);
                transform: translateY(-50%);
                border-top: 8px solid transparent;
                border-bottom: 8px solid transparent;
            }

            .pc-annotation.arrow-right::before {
                left: -8px;
                border-right: 8px solid rgba(252, 252, 253, 0.92);
            }

            .pc-annotation.arrow-left::before {
                right: -8px;
                border-left: 8px solid rgba(252, 252, 253, 0.92);
            }

            .pc-annotation-hotspot {
                display: none;
                position: absolute;
                width: ${size + 5}px;
                height: ${size + 5}px;
                opacity: 0;
                cursor: pointer;
                transform: translate(-50%, -50%);
            }

            /* Mobile/touch: static glass (perf). backdrop-filter re-samples
               the live 3D canvas behind the tooltip every frame, which costs
               real GPU on phones. Kill the blur and compensate with a
               mostly-opaque white so the ink text stays legible over dark
               floors — mirrors the (pointer: coarse) override in index.scss. */
            @media (pointer: coarse) {
                .pc-annotation {
                    -webkit-backdrop-filter: none;
                    backdrop-filter: none;
                    background:
                        radial-gradient(135% 130% at 50% -14%, rgba(255, 255, 255, 0.98), rgba(255, 255, 255, 0) 62%),
                        linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(247, 248, 250, 0.88));
                }
            }
        `;

        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
        Annotation.styleSheet = style;
    }

    /**
     * Initialize static resources.
     * @param {AppBase} app - The application instance
     * @private
     */
    static _initializeStatic(app: AppBase) {
        if (Annotation.styleSheet) {
            return;
        }

        Annotation._injectStyles(Annotation.hotspotSize);

        if (Annotation.parentDom === null) {
            Annotation.parentDom = document.body;
        }

        const { layers } = app.scene;
        const worldLayer = layers.getLayerByName('World');

        const createLayer = (name: string, semitrans: boolean) => {
            const layer = new Layer({ name: name });
            const idx = semitrans ? layers.getTransparentIndex(worldLayer) : layers.getOpaqueIndex(worldLayer);
            layers.insert(layer, idx + 1);
            return layer;
        };

        Annotation.layers = [
            createLayer('HotspotBase', false),
            createLayer('HotspotOverlay', true)
        ];

        if (Annotation.camera === null) {
            Annotation.camera = app.root.findComponent('camera').entity;
        }

        Annotation.camera.camera.layers = [
            ...Annotation.camera.camera.layers,
            ...Annotation.layers.map(layer => layer.id)
        ];

        Annotation.mesh = Mesh.fromGeometry(app.graphicsDevice, new PlaneGeometry({
            widthSegments: 1,
            lengthSegments: 1
        }));

        // Initialize tooltip dom
        Annotation.tooltipDom = document.createElement('div');
        Annotation.tooltipDom.className = 'pc-annotation';

        Annotation.titleDom = document.createElement('div');
        Annotation.titleDom.className = 'pc-annotation-title';
        Annotation.tooltipDom.appendChild(Annotation.titleDom);

        Annotation.textDom = document.createElement('div');
        Annotation.textDom.className = 'pc-annotation-text';
        Annotation.tooltipDom.appendChild(Annotation.textDom);

        Annotation.parentDom.appendChild(Annotation.tooltipDom);
    }

    /**
     * Creates a circular hotspot texture.
     * @param {AppBase} app - The PlayCanvas AppBase
     * @param {string} label - Label text to draw on the hotspot
     * @param {number} [size] - The texture size (should be power of 2)
     * @param {number} [borderWidth] - The border width in pixels
     * @returns {Texture} The hotspot texture
     * @private
     */
    static _createHotspotTexture(app: AppBase, label: string, size = 256, borderWidth = 24) {
        // 256px (was 64): the marker renders over the splat canvas, which on
        // phones is resolution-capped — a small texture upscaled there read as
        // pixelated. 256 + mipmaps stays crisp at every zoom/DPR. All draw
        // constants below scale with `size`, so bumping it needs no other edit.
        // Create canvas for hotspot texture
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // First clear with stroke color at zero alpha
        ctx.fillStyle = 'white';
        ctx.globalAlpha = 0;
        ctx.fillRect(0, 0, size, size);
        ctx.globalAlpha = 1.0;

        // Draw dark circle with light border
        const centerX = size / 2;
        const centerY = size / 2;
        const radius = (size / 2) - borderWidth - 4; // Leave space for border

        // Draw main circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'black';
        ctx.fill();

        // Draw border
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.lineWidth = borderWidth;
        ctx.strokeStyle = 'white';
        ctx.stroke();

        // Draw text (font scales with the texture size so it stays crisp)
        ctx.font = `bold ${Math.round(size * 0.5)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'white';
        ctx.fillText(label, Math.floor(canvas.width / 2), Math.floor(canvas.height / 2) + Math.round(size / 64));

        // get pixel data
        const imageData = ctx.getImageData(0, 0, size, size);
        const data = imageData.data;

        // set the color channel of semitransparent pixels to white so the blending at
        // the edges is correct
        for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a < 255) {
                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
            }
        }

        const texture = new Texture(app.graphicsDevice, {
            width: size,
            height: size,
            format: PIXELFORMAT_RGBA8,
            magFilter: FILTER_LINEAR,
            // trilinear + mipmaps: crisp when the marker is small/far (aerial,
            // walking away) instead of the aliased shimmer of a single level
            minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
            mipmaps: true,
            levels: [new Uint8Array(data.buffer)]
        });

        return texture;
    }

    /**
     * Creates a material for hotspot rendering.
     * @param {Texture} texture - The texture to use for emissive and opacity
     * @param {object} [options] - Material options
     * @param {number} [options.opacity] - Base opacity multiplier
     * @param {boolean} [options.depthTest] - Whether to perform depth testing
     * @param {boolean} [options.depthWrite] - Whether to write to depth buffer
     * @returns {StandardMaterial} The configured material
     * @private
     */
    static _createHotspotMaterial(texture: Texture, { opacity = 1, depthTest = true, depthWrite = true } = {}) {
        const material = new StandardMaterial();

        // Base properties
        material.diffuse = Color.BLACK;
        material.emissive.copy(Annotation.hotspotColor);
        material.emissiveMap = texture;
        material.opacityMap = texture;

        // Alpha properties
        material.opacity = opacity;
        material.alphaTest = 0.01;
        material.blendState = new BlendState(
            true,
            BLENDEQUATION_ADD, BLENDMODE_SRC_ALPHA, BLENDMODE_ONE_MINUS_SRC_ALPHA,
            BLENDEQUATION_ADD, BLENDMODE_ONE, BLENDMODE_ONE
        );

        // Depth properties
        material.depthTest = depthTest;
        material.depthWrite = depthWrite;

        // Rendering properties
        material.cull = CULLFACE_NONE;
        material.useLighting = false;

        material.shaderChunks.glsl.add({
            'litUserMainEndVS': depthClampGlsl
        });
        material.shaderChunks.wgsl.add({
            'litUserMainEndVS': depthClampWgsl
        });

        material.update();
        return material;
    }

    initialize() {
        // Ensure static resources are initialized
        Annotation._initializeStatic(this.app);

        // Create texture
        this.texture = Annotation._createHotspotTexture(this.app, this.label);

        // Create material the base and overlay material
        this.materials = [
            Annotation._createHotspotMaterial(this.texture, {
                opacity: 1,
                depthTest: true,
                depthWrite: true
            }),
            Annotation._createHotspotMaterial(this.texture, {
                opacity: 0.25,
                depthTest: false,
                depthWrite: false
            })
        ];

        const base = new Entity('base');
        const baseMi = new MeshInstance(Annotation.mesh, this.materials[0]);
        baseMi.cull = false;
        base.addComponent('render', {
            layers: [Annotation.layers[0].id],
            meshInstances: [baseMi]
        });

        const overlay = new Entity('overlay');
        const overlayMi = new MeshInstance(Annotation.mesh, this.materials[1]);
        overlayMi.cull = false;
        overlay.addComponent('render', {
            layers: [Annotation.layers[1].id],
            meshInstances: [overlayMi]
        });

        this.entity.addChild(base);
        this.entity.addChild(overlay);

        // Create hotspot dom
        this.hotspotDom = document.createElement('div');
        this.hotspotDom.className = 'pc-annotation-hotspot';

        // Add click handlers
        this.hotspotDom.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showTooltip();
        });

        const leave = () => {
            if (Annotation.hoverAnnotation === this) {
                Annotation.hoverAnnotation = null;
                this.setHover(false);
            }
        };

        const enter = () => {
            if (Annotation.hoverAnnotation !== null) {
                Annotation.hoverAnnotation.setHover(false);
            }
            Annotation.hoverAnnotation = this;
            this.setHover(true);
        };

        this.hotspotDom.addEventListener('pointerenter', enter);
        this.hotspotDom.addEventListener('pointerleave', leave);

        // Close the tooltip on an outside click. Kept as a bound reference so
        // destroy() can remove it — previously this document listener (and the
        // prerender handler below) leaked for the life of the page on every
        // annotation, and _update kept running for destroyed annotations.
        this._onDocClick = () => {
            if (Annotation.activeAnnotation === this) {
                this.hideTooltip();
            }
        };
        document.addEventListener('click', this._onDocClick);

        Annotation.parentDom.appendChild(this.hotspotDom);

        // Clean up on entity destruction
        this.on('destroy', () => {
            if (this._onPrerender) {
                this.app.off('prerender', this._onPrerender);
                this._onPrerender = null;
            }
            if (this._onDocClick) {
                document.removeEventListener('click', this._onDocClick);
                this._onDocClick = null;
            }

            this.hotspotDom.remove();
            if (Annotation.activeAnnotation === this) {
                this.hideTooltip();
            }

            this.materials.forEach(mat => mat.destroy());
            this.materials = [];

            this.texture.destroy();
            this.texture = null;
        });

        this._onPrerender = () => this._update();
        this.app.on('prerender', this._onPrerender);
    }

    /**
     * Update screen-space elements and materials for this annotation. Called each frame from the
     * prerender callback, and also directly from showTooltip to ensure the tooltip is positioned
     * correctly even when the camera hasn't moved (e.g. annotations sharing the same camera pose).
     * @private
     */
    _update() {
        if (!Annotation.camera) return;

        const position = this.entity.getPosition();
        const screenPos = Annotation.camera.camera.worldToScreen(position, screenVec);

        const { viewMatrix } = Annotation.camera.camera;
        viewMatrix.transformPoint(position, vec);
        if (vec.z >= 0) {
            this._hideElements();
            return;
        }

        this._updatePositions(screenPos);
        this._updateRotationAndScale(-vec.z);

        // Material opacity + the uniform mirror only need writing when the
        // opacity actually changes (marker hidden toggles, fade in/out) — not
        // every frame for every annotation. Skipping the redundant
        // setParameter avoids per-frame shader-uniform churn.
        //
        // Hidden markers get ONE exception: on phones the tooltip is a
        // bottom-centre sheet decoupled from its 3D point (see
        // _updatePositions), so nothing shows WHICH feature the text is about.
        // While the visitor is actively browsing a highlight (its tooltip is
        // up → it is the activeAnnotation), reveal just that one point's dot so
        // the card is anchored again. Not persistent: only the active one, only
        // in sheet layout. Desktop keeps markers hidden — there the card sits
        // at the point with an arrow already.
        const activeSheetDot =
            Annotation.activeAnnotation === this && window.innerWidth <= 520;
        const markerOpacity = (Annotation.markersHidden && !activeSheetDot) ? 0 : Annotation.opacity;
        if (markerOpacity !== this._lastMarkerOpacity) {
            this._lastMarkerOpacity = markerOpacity;
            this.materials[0].opacity = markerOpacity;
            this.materials[1].opacity = 0.25 * markerOpacity;
            this.materials[0].setParameter('material_opacity', markerOpacity);
            this.materials[1].setParameter('material_opacity', 0.25 * markerOpacity);
        }
    }

    /**
     * Set the hover state of the annotation.
     * @param hover - Whether the annotation is hovered
     * @private
     */
    setHover(hover: boolean) {
        this.materials.forEach((material) => {
            material.emissive.copy(hover ? Annotation.hoverColor : Annotation.hotspotColor);
            material.update();
        });
        this.fire('hover', hover);
    }

    /**
     * @private
     */
    showTooltip() {
        Annotation.activeAnnotation = this;
        Annotation.tooltipDom.style.visibility = 'visible';
        Annotation.tooltipDom.style.opacity = '1';
        Annotation.titleDom.textContent = this.title;
        Annotation.textDom.textContent = this.text;

        // Immediately update incase the camera doesn't move
        this._update();

        this.fire('show', this);
    }

    /**
     * @private
     */
    hideTooltip() {
        Annotation.activeAnnotation = null;
        Annotation.tooltipDom.style.opacity = '0';

        // Wait for fade out before hiding
        setTimeout(() => {
            if (Annotation.tooltipDom.style.opacity === '0') {
                Annotation.tooltipDom.style.visibility = 'hidden';
                this.fire('hide');
            }
        }, 200); // Match the transition duration
    }

    /**
     * Display-only tooltip reveal for the guided tour's fly-by: identical
     * visuals (same 0.2s opacity fade) to showTooltip, but fires NO events —
     * the camera manager must never treat it as an annotation pick, which
     * would hijack the running tour into orbit mode.
     */
    showTooltipPassive() {
        Annotation.activeAnnotation = this;
        Annotation.tooltipDom.style.visibility = 'visible';
        Annotation.tooltipDom.style.opacity = '1';
        Annotation.titleDom.textContent = this.title;
        Annotation.textDom.textContent = this.text;
        this._update();
    }

    /** Event-free counterpart of hideTooltip (see showTooltipPassive). */
    hideTooltipPassive() {
        if (Annotation.activeAnnotation === this) {
            Annotation.activeAnnotation = null;
        }
        Annotation.tooltipDom.style.opacity = '0';
        setTimeout(() => {
            if (Annotation.tooltipDom.style.opacity === '0') {
                Annotation.tooltipDom.style.visibility = 'hidden';
            }
        }, 200); // Match the transition duration
    }

    /**
     * Hide all elements when annotation is behind camera.
     * @private
     */
    _hideElements() {
        this.hotspotDom.style.display = 'none';
        if (Annotation.activeAnnotation === this) {
            Annotation.tooltipDom.style.visibility = 'hidden';
            Annotation.tooltipDom.style.opacity = '0';
        }
    }

    /**
     * Update screen-space positions of HTML elements.
     * @param {Vec3} screenPos - Screen coordinate
     * @private
     */
    _updatePositions(screenPos: Vec3) {
        // Show and position hotspot (hidden markers keep no hit zone either)
        this.hotspotDom.style.display = Annotation.markersHidden ? 'none' : 'block';
        this.hotspotDom.style.left = `${screenPos.x}px`;
        this.hotspotDom.style.top = `${screenPos.y}px`;

        // Re-show tooltip if it was hidden while behind camera
        if (Annotation.activeAnnotation === this) {
            Annotation.tooltipDom.style.visibility = 'visible';
            Annotation.tooltipDom.style.opacity = '1';
        }

        // Position tooltip, clamped to viewport
        if (Annotation.activeAnnotation === this) {
            const tooltip = Annotation.tooltipDom;
            const margin = 8;
            const arrowOffset = 25;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            // Narrow screens (phones): a 240px bubble beside a mid-screen point
            // fits on neither side, so the old code jammed it against an edge
            // with the arrow pointing nowhere. Switch to the standard mobile
            // pattern instead — a compact card anchored bottom-centre (like a
            // map POI card), sized by CSS via the .sheet class, no arrow.
            const sheet = vw <= 520;
            tooltip.classList.toggle('sheet', sheet);
            const tw = tooltip.offsetWidth;
            const th = tooltip.offsetHeight;

            if (sheet) {
                tooltip.classList.remove('arrow-right', 'arrow-left');
                tooltip.style.transform = 'none';
                tooltip.style.left = `${Math.round((vw - tw) / 2)}px`;
                // sit above the control dome (bottom: 14px + dome height)
                tooltip.style.top = `${Math.max(margin, vh - th - 88)}px`;
                return;
            }

            // Desktop: to the right of the hotspot, vertically centered.
            let left = screenPos.x + arrowOffset;
            let top = screenPos.y - th / 2;
            let flipped = false;

            // If tooltip overflows right edge, flip to left side of hotspot
            if (left + tw > vw - margin) {
                left = screenPos.x - arrowOffset - tw;
                flipped = true;
            }

            // Clamp horizontal
            left = Math.max(margin, Math.min(left, vw - tw - margin));

            // Clamp vertical
            top = Math.max(margin, Math.min(top, vh - th - margin));

            // Position arrow to point at the hotspot, clamped within the tooltip
            const arrowY = Math.max(16, Math.min(screenPos.y - top, th - 16));
            tooltip.style.setProperty('--arrow-top', `${arrowY}px`);

            tooltip.classList.toggle('arrow-right', !flipped);
            tooltip.classList.toggle('arrow-left', flipped);
            tooltip.style.transform = 'none';
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
        }
    }

    /**
     * Update 3D rotation and scale of hotspot planes.
     * @param {number} viewDepth - The view-space depth (positive distance along the camera's forward direction)
     * @private
     */
    _updateRotationAndScale(viewDepth: number) {
        // Copy camera rotation to align with view plane
        const cameraRotation = Annotation.camera.getRotation();
        this._updateHotspotTransform(this.entity, cameraRotation);

        // Calculate scale based on view depth to maintain constant screen size
        const scale = this._calculateScreenSpaceScale(viewDepth);
        this.entity.setLocalScale(scale, scale, scale);
    }

    /**
     * Update rotation of a single hotspot entity.
     * @param {Entity} hotspot - The hotspot entity to update
     * @param {Quat} cameraRotation - The camera's current rotation
     * @private
     */
    _updateHotspotTransform(hotspot: Entity, cameraRotation: Quat) {
        hotspot.setRotation(cameraRotation);
        hotspot.rotateLocal(90, 0, 0);
    }

    /**
     * Calculate scale factor to maintain constant screen-space size.
     * @param {number} viewDepth - The view-space depth (positive distance along the camera's forward direction)
     * @returns {number} The scale to apply to hotspot entities
     * @private
     */
    _calculateScreenSpaceScale(viewDepth: number) {
        // Use the canvas's CSS/client height instead of graphics device height
        const canvas = this.app.graphicsDevice.canvas;
        const screenHeight = canvas.clientHeight;

        // Use view-space depth (not Euclidean distance) to match the projection matrix
        const projMatrix = Annotation.camera.camera.projectionMatrix;
        const worldSize = (Annotation.hotspotSize / screenHeight) * (2 * viewDepth / projMatrix.data[5]);

        return worldSize;
    }
}
