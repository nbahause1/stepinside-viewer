import type { PointerLockManager } from './pointer-lock';
import type { Global } from '../../types';

const isCaptureMode = (mode: string) => mode === 'walk' || mode === 'fly';

/**
 * Keyboard shortcuts that switch camera mode and toggle UI affordances.
 * Listens on `window` so the user can press 1/2/3, V, G, H, F, R, Space,
 * or Escape regardless of which element has focus.
 */
class ModeShortcuts {
    private _global: Global | null = null;

    private _pointerLock: PointerLockManager | null = null;

    private _onKeyDown = (event: KeyboardEvent) => {
        const global = this._global;
        if (!global) return;
        const { state, events } = global;

        // While the concierge chat is open, the visitor is typing — no viewer
        // shortcut (mode switch, reset, help, …) may fire, regardless of where
        // focus currently sits. This bulletproofs typing against any stray key
        // that escapes the chat input's own stopPropagation.
        if (state.chatOpen) {
            return;
        }

        // The free orbit/fly cameras are AUTHORING tools: a visitor escaping
        // walk mode onto a ground-level free orbit can drag the splat into
        // half-captured perspectives. All shortcuts that reach those modes
        // (Escape-out-of-walk, 1/2/3, F) are therefore debug-entry only
        // (?debug / ?scout / ?record); visitors keep walk / bird's-eye /
        // highlights as the only cameras.
        const devtools = global.config.devtools;

        if (event.key === 'Escape') {
            if (this._pointerLock?.recentlyExitedCapture) {
                // already handled by pointerlockchange
            } else if (isCaptureMode(state.cameraMode) && state.gamingControls && state.inputMode === 'desktop') {
                state.gamingControls = false;
            } else if (state.cameraMode === 'walk') {
                // walking is the visitor's base mode — nothing to escape to
                if (devtools) {
                    events.fire('inputEvent', 'exitWalk', event);
                }
            } else {
                events.fire('inputEvent', 'cancel', event);
            }
            return;
        }

        if (event.ctrlKey || event.altKey || event.metaKey) {
            return;
        }

        switch (event.key) {
            case '1':
                if (devtools) state.cameraMode = 'orbit';
                break;
            case '2':
                if (devtools) state.cameraMode = 'fly';
                break;
            case '3':
                if (devtools) events.fire('inputEvent', 'toggleWalk');
                break;
            case 'v':
                if (state.hasCollisionOverlay) {
                    state.collisionOverlayEnabled = !state.collisionOverlayEnabled;
                }
                break;
            case 'g':
                state.gamingControls = !state.gamingControls;
                break;
            case 'h':
                events.fire('inputEvent', 'toggleHelp');
                break;
            case 'r':
                events.fire('inputEvent', 'reset', event);
                break;
            // WASD intentionally does nothing: it used to flip into fly mode and
            // enable gaming controls (engaging pointer-lock free-look), which is
            // exactly the behaviour we want gone. Keyboard locomotion is off.
        }

        if (state.cameraMode !== 'walk') {
            switch (event.key) {
                case 'f':
                    // frames the whole scene in free orbit — authoring only
                    if (devtools) events.fire('inputEvent', 'frame', event);
                    break;
                case ' ':
                    events.fire('inputEvent', 'playPause', event);
                    break;
            }
        }
    };

    attach(global: Global, pointerLock: PointerLockManager): void {
        this._global = global;
        this._pointerLock = pointerLock;
        window.addEventListener('keydown', this._onKeyDown);
    }

    detach(): void {
        window.removeEventListener('keydown', this._onKeyDown);
        this._global = null;
        this._pointerLock = null;
    }
}

export { ModeShortcuts };
