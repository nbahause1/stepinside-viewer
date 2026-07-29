// StepInside Studio — a local drag-and-drop app that turns a raw scan into the
// finished, viewable product. Wraps the onboard pipeline (prepare -> derive) in
// a tiny dependency-free web UI so a scan goes in and a walkable, auto-configured
// viewer comes out — all on this machine, using this machine's GPU.
//
//   node tools/studio/server.mjs [port]
//
// Then open the printed URL, drag a .ply/.sog onto the page, give it a name,
// and press Start. Progress streams live; when done, "Ansehen" opens the result.
//
// Everything stays local: uploads land in dist/studio-uploads, the finished
// asset set in dist/onboard/<name>/v1, both served from this same server so the
// preview works without any cloud step. (Upload to R2 stays the separate,
// deliberate `tools/upload-scan.mjs` step.)
import http from 'node:http';
import { createWriteStream, createReadStream, mkdirSync, existsSync, statSync, renameSync, writeFileSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve, extname, normalize, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');            // tools/studio -> repo root
const UPLOADS = join(repo, 'dist', 'studio-uploads');
const OUTROOT = join(repo, 'dist', 'onboard');
const VIEWER_ROOT = join(repo, 'apps', 'website', 'public'); // serves /viewer/*
mkdirSync(UPLOADS, { recursive: true });
mkdirSync(OUTROOT, { recursive: true });

const PORT = Number(process.argv[2]) || 4545;
const PID_RE = /^[a-z0-9-]{1,64}$/;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const STAGE_HOST = 'http://localhost:8787';

// Ensure the concierge /stage API is reachable (staging needs it). A GET returns
// 405 when it's up (POST-only) — reaching it at all counts. Spawn its dev server
// if it's down so the Studio flow is self-contained. Best-effort + fail-soft.
async function ensureStageApi(send) {
    const up = async () => { try { await fetch(STAGE_HOST + '/'); return true; } catch { return false; } };
    if (await up()) return;
    send?.('log', 'Starte Staging-API (concierge dev-server :8787) …');
    spawn('npm', ['run', 'dev'], { cwd: join(repo, 'apps', 'concierge-api'), shell: true, detached: true, stdio: 'ignore' });
    for (let i = 0; i < 12; i++) { await sleep(1000); if (await up()) return; }
}

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2',
    '.sog': 'application/octet-stream', '.bin': 'application/octet-stream',
    '.md': 'text/plain; charset=utf-8'
};
const mime = p => MIME[extname(p).toLowerCase()] || 'application/octet-stream';

// Serve a file from an allowed root, blocking path traversal.
const serveFile = (res, root, relPath) => {
    const full = normalize(join(root, relPath));
    if (!full.startsWith(root + sep) || !existsSync(full) || !statSync(full).isFile()) {
        res.writeHead(404).end('not found');
        return;
    }
    res.writeHead(200, { 'Content-Type': mime(full), 'Cache-Control': 'no-store' });
    createReadStream(full).pipe(res);
};

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = decodeURIComponent(url.pathname);

    // --- UI ---------------------------------------------------------------
    if (req.method === 'GET' && path === '/') {
        const html = await readFile(join(here, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
        return;
    }

    // --- upload: stream the raw body straight to disk ---------------------
    if (req.method === 'PUT' && path === '/upload') {
        const name = (req.headers['x-filename'] || 'scan').toString().replace(/[^A-Za-z0-9._-]/g, '_');
        const dest = join(UPLOADS, `${Date.now()}-${name}`);
        const ws = createWriteStream(dest);
        req.pipe(ws);
        ws.on('finish', () => res.writeHead(200, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ file: dest })));
        ws.on('error', () => res.writeHead(500).end('upload failed'));
        return;
    }

    // --- process: run the pipeline, stream progress as Server-Sent Events -
    if (req.method === 'GET' && path === '/process') {
        const file = url.searchParams.get('file') || '';
        const pid = url.searchParams.get('pid') || '';
        if (!PID_RE.test(pid) || !normalize(file).startsWith(UPLOADS) || !existsSync(file)) {
            res.writeHead(400).end('bad request');
            return;
        }
        res.writeHead(200, {
            'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive'
        });
        const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send('log', `Starte Verarbeitung von ${file.split(/[\\/]/).pop()} …`);

        // Fast mode by default: the Studio is for scans you've already cleaned
        // yourself, so skip the redundant GPU floater filter and heavy SOG
        // iterations — optimise for "see it quickly". Set SI_FAST=0 to override.
        const child = spawn('node', ['tools/onboard-scan.mjs', file, pid, 'v1', '--no-upload'],
            { cwd: repo, shell: true, env: { ...process.env, SI_FAST: process.env.SI_FAST ?? '1' } });
        const relay = buf => buf.toString().split(/\r?\n/).forEach(l => l.trim() && send('log', l));
        child.stdout.on('data', relay);
        child.stderr.on('data', relay);
        let staging = null;
        child.on('close', async code => {
            if (code !== 0) {
                send('error', `Pipeline mit Code ${code} beendet.`);
                res.end();
                return;
            }
            const base = `/out/${pid}/v1`;
            // tier=high + nofillrate: the Studio preview is for QUALITY review on
            // a strong local machine — force full resolution (the Mac fillrate
            // profile otherwise drops resolution while moving, which reads as
            // flicker/blur). Visitor devices keep their adaptive defaults.
            const previewUrl = `/viewer/?assets=${base}&settings=${base}/settings.json&tier=high&nofillrate`;

            // STAGE: pre-generate the "Möbliert sehen" stills headless — capture
            // the aerial frame from the real viewer, auto-detect furnished, empty
            // if needed, furnish, save. Fail-soft: a staging failure never fails
            // the scan (walkable + measured still ship).
            send('log', '── Möblierung: Luftbild greifen → erkennen → ausräumen → möblieren …');
            try { await ensureStageApi(send); } catch { /* best-effort */ }
            staging = spawn('node', ['apps/trailer-render/stage-scan.mjs', pid],
                { cwd: repo, shell: true, env: { ...process.env } });
            staging.stdout.on('data', relay);
            staging.stderr.on('data', relay);
            staging.on('close', sc => {
                if (sc !== 0) send('log', '⚠ Möblierung übersprungen — Scan ist trotzdem fertig (begehbar + vermessen).');
                send('done', { previewUrl, staged: sc === 0 });
                res.end();
            });
        });
        req.on('close', () => { try { child.kill(); } catch {} try { staging?.kill(); } catch {} });
        return;
    }

    // --- save-settings: the viewer's ?author mode posts authored rooms /
    // annotations here; they are merged into the asset set's settings.json.
    // Replace-array semantics: the client always sends the FULL desired array
    // (it starts from the currently-loaded settings), so add/remove both work
    // and a re-save is idempotent. Atomic write (tmp + rename) so a crash can
    // never leave a half-written settings.json behind.
    if (req.method === 'POST' && path === '/save-settings') {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const { pid, version } = body;
                if (!PID_RE.test(pid || '') || !/^v\d+$/.test(version || '')) {
                    res.writeHead(400).end('bad pid/version');
                    return;
                }
                const settingsPath = normalize(join(OUTROOT, pid, version, 'settings.json'));
                if (!settingsPath.startsWith(OUTROOT + sep) || !existsSync(settingsPath)) {
                    res.writeHead(404).end('no such asset set');
                    return;
                }
                // Structural validation BEFORE writing: a malformed entry that
                // slips into settings.json would fail the viewer's own boot-time
                // validate and brick the preview. 400 here beats debugging there.
                const isNum = n => typeof n === 'number' && Number.isFinite(n);
                const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(isNum);
                const isLine = l => l && isVec3(l.a) && isVec3(l.b);
                // name/center/area are optional: the pipeline's nameless
                // dollhouse-footprint entry has only lines[] and must round-trip.
                const validRoom = r => r && Array.isArray(r.lines) && r.lines.length > 0 && r.lines.every(isLine) &&
                    (r.name === undefined || typeof r.name === 'string') &&
                    (r.center === undefined || isVec3(r.center)) &&
                    (r.area === undefined || isNum(r.area));
                const validAnn = a => a && isVec3(a.position) &&
                    typeof a.title === 'string' && a.title.length > 0 &&
                    typeof a.text === 'string' &&
                    a.camera && a.camera.initial &&
                    isVec3(a.camera.initial.position) && isVec3(a.camera.initial.target) &&
                    isNum(a.camera.initial.fov);
                const validSeat = st => st && isVec3(st.position) && isNum(st.yaw);
                const roomsOk = body.rooms === undefined || (Array.isArray(body.rooms) && body.rooms.every(validRoom));
                const annsOk = body.annotations === undefined || (Array.isArray(body.annotations) && body.annotations.every(validAnn));
                const seatsOk = body.seats === undefined || (Array.isArray(body.seats) && body.seats.every(validSeat));
                if (!roomsOk || !annsOk || !seatsOk) {
                    res.writeHead(400).end(!roomsOk ? 'invalid rooms entry' : (!annsOk ? 'invalid annotations entry' : 'invalid seats entry'));
                    return;
                }

                const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
                if (Array.isArray(body.rooms)) settings.rooms = body.rooms;
                if (Array.isArray(body.seats)) settings.seats = body.seats;
                if (Array.isArray(body.annotations)) {
                    settings.annotations = body.annotations;
                    // annotationMarkers stays UNTOUCHED — the live product runs
                    // 'hidden' (no numbered dots; highlights surface via the
                    // ‹ › navigator + proximity/stand-still tooltips). Authored
                    // scans must behave exactly like the product.
                }
                const tmp = `${settingsPath}.tmp`;
                writeFileSync(tmp, JSON.stringify(settings, null, 2));
                renameSync(tmp, settingsPath);
                res.writeHead(200, { 'Content-Type': 'application/json' })
                    .end(JSON.stringify({ ok: true, rooms: settings.rooms?.length ?? 0, annotations: settings.annotations?.length ?? 0 }));
            } catch (err) {
                res.writeHead(400).end(`save failed: ${err.message}`);
            }
        });
        return;
    }

    // --- static: finished asset sets under /out/, the viewer under /viewer/
    if (req.method === 'GET' && path.startsWith('/out/')) {
        serveFile(res, OUTROOT, path.slice('/out/'.length));
        return;
    }
    if (req.method === 'GET' && path.startsWith('/viewer/')) {
        let rel = path.slice('/viewer/'.length) || 'index.html';
        if (rel === '' || rel.endsWith('/')) rel += 'index.html';
        serveFile(res, VIEWER_ROOT, join('viewer', rel));
        return;
    }

    res.writeHead(404).end('not found');
});

server.listen(PORT, () => {
    console.log(`\n  StepInside Studio läuft:  http://localhost:${PORT}\n`);
    console.log('  Scan reinziehen → Name vergeben → Start. Läuft lokal, nutzt deine GPU.\n');
});
