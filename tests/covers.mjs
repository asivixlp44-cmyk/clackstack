// The two store covers (1920x1080, 800x800), rendered from the game itself at High: you mid-jump up a flight of giant keycaps in the
// synth sunset glow, Pals hopping behind, a rainbow trail, the next flights winding up round the pillar and the sea of clouds far below; the
// frame held, the HUD hidden; then the title and the tagline over it in the game's own lettering.
// Run: node tests/covers.mjs   (TEST_PORT / VITE_PORT move it)
import fs from 'node:fs';
import path from 'node:path';
import { startServer, startVite, stopAll, launch, open, qa, sleep, ROOT, TEST_PORT, VITE_PORT } from './lib.mjs';
import { buildStage, toWorld, yawOf } from '../shared/world.js';

await startServer(TEST_PORT, { QA: '1' });
await startVite();
const browser = await launch();
const dir = path.join(ROOT, 'covers');
fs.mkdirSync(dir, { recursive: true });

const N = '#3a0a4a', F = "'Luckiest Guy', 'Arial Black', sans-serif";
let gid = 0;
// one line of words, centred: spans [{ t, c: [top, bottom] }], baseline y, outline width
const words = (spans, size, y, stroke, ls) => {
    const id = 'w' + (gid++);
    const grads = spans.map((s, i) => `<linearGradient id="${id}${i}" x1="0" y1="0" x2="0" y2="1">${s.c.map((c, k) => `<stop offset="${k / (s.c.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient>`).join('');
    const line = (fill, extra) => `<text x="50%" y="${y}" text-anchor="middle" font-family="${F}" font-size="${size}" letter-spacing="${ls}" ${extra}>${spans.map((s, i) => `<tspan fill="${fill || `url(#${id}${i})`}">${s.t}</tspan>`).join('')}</text>`;
    const out = `stroke="${N}" stroke-width="${stroke * 2}" stroke-linejoin="round"`;
    return `<defs>${grads}</defs>${line(N, out + ` transform="translate(0 ${Math.round(size * 0.075)})"`)}${line(N, out)}${line('', '')}`;
};
function lettering(w) {
    const sq = w < 1000, T = sq ? 150 : 196, top = sq ? 18 : 22;
    const WHITE = ['#ffffff', '#ffe0f4'], RAIN = ['#ff7ac4', '#ffd23a', '#7dff6b', '#5ad8ff'];
    const y1 = top + T * 0.86, H = sq ? y1 + T * 0.95 + 30 : y1 + 40;
    const title = sq ? words([{ t: 'CLACK', c: WHITE }], T, y1, 12, 3) + words([{ t: 'STACK', c: RAIN }], T, y1 + T * 0.92, 12, 3) : words([{ t: 'CLACK', c: WHITE }, { t: 'STACK', c: RAIN }], T, y1, 13, 4);
    const tag = sq ? 44 : 60;
    return `<div id="cover" style="position:fixed;inset:0;z-index:99;pointer-events:none;overflow:hidden">`
        + `<svg style="position:absolute;left:0;top:0;overflow:visible;filter:drop-shadow(0 10px 18px rgba(40,0,60,.45))" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">${title}</svg>`
        + `<div style="position:absolute;left:50%;bottom:${sq ? 26 : 38}px;transform:translateX(-50%) rotate(-1.5deg);white-space:nowrap;font-family:${F};font-size:${tag}px;line-height:1;padding:${tag * 0.26}px ${tag * 0.6}px ${tag * 0.14}px;border-radius:${tag * 0.4}px;background:linear-gradient(#ffb0e8,#ff4ab8);color:#fff;border:${sq ? 5 : 6}px solid ${N};box-shadow:0 ${sq ? 6 : 8}px 0 ${N};text-shadow:0 4px 0 ${N},-3px -3px 0 ${N},3px -3px 0 ${N},-3px 3px 0 ${N},3px 3px 0 ${N}">CLIMB THE ENDLESS TOWER!</div>`
        + '</div>';
}

// a sunset stage that starts with sixteen rows of full stairs: you on its fifth row, looking up the flight
const STAGE = 97, st = buildStage(STAGE), key = st.pathKey[4], at = toWorld(STAGE, key.u, key.v), YAW = yawOf(STAGE);
const SHOTS = [{ w: 1920, h: 1080, name: 'cover-1920x1080.png', look: [0.42, -0.08, 21] }, { w: 800, h: 800, name: 'cover-800x800.png', look: [0.38, -0.05, 23] }];
try {
    for (const s of SHOTS) {
        const page = await open(browser, `http://localhost:${VITE_PORT}/`, { w: s.w, h: s.h, dpr: 1, q: 'high', uid: 'cover' + s.w + Date.now() });
        await qa(page, (n) => {
            const q = window.__qa; q.noWatch(true);
            q.give({ best: n + 1, cp: n, coins: 1e7, wins: 9, tut: 9, team: ['uni', 'prism', 'cloud'], items: ['double', 'carpet', 'hop', 'rainbow'] });
            q.send('trail', { id: 'pink' });
        }, STAGE);
        await sleep(600);
        await qa(page, (n) => window.__qa.toLanding(n), STAGE);
        await sleep(2500);
        await qa(page, () => { const q = window.__qa; q.close(); q.hud(false); for (const sel of ['#toasts', '#bigText', '#popup', '#fps', '#tips', '#flyLayer', '#promptBtn', '#summit']) { const e = document.querySelector(sel); if (e) e.style.display = 'none'; } });
        // on the stairs, the camera low behind you looking up the flight (the pillar on one side, the sunset on the other), then a jump
        await qa(page, (o) => { const q = window.__qa; q.teleport(o.x, o.y + 0.05, o.z, o.ry); }, { x: at.x, y: key.top, z: at.z, ry: YAW + Math.PI });
        await sleep(1500);
        await qa(page, (o) => window.__qa.look(o.yaw + o.look[0], o.look[1], o.look[2]), { yaw: YAW, look: s.look });
        await sleep(900);
        await qa(page, () => window.__qa.jump());
        await sleep(380);
        await page.evaluate(() => { window.__raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; });
        await sleep(150);
        await page.evaluate((html) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d.firstChild); }, lettering(s.w));
        await page.evaluate(() => document.fonts.ready);
        await sleep(300);
        await page.screenshot({ path: path.join(dir, s.name), type: 'png' });
        console.log('wrote', s.name, page.errors);
        await page.close();
    }
} catch (e) { console.error(e); } finally { await browser.close(); stopAll(); }
process.exit(0);
