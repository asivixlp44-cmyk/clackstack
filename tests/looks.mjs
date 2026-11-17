// Screenshots for judging the look: the plaza, the stairs up close, and the tower at several heights (each sky mood), with and without
// the HUD. node tests/looks.mjs [quality] [only]  (quality: high|medium|low, default high; only: a shot name to take just that one)
import { startServer, startVite, stopAll, launch, open, qa, shot, sleep, OUT, VITE_PORT } from './lib.mjs';

const Q = process.argv[2] || 'high';
const ONLY = process.argv[3];
// [name, landing, look yaw offset, pitch, dist, hud, walk secs]
const SHOTS = [
    ['plaza', 0, 0, 0.18, 18, true, 0],
    ['stairs-close', 2, 0.5, 0.42, 9, false, 0.9],
    ['stairs-hud', 3, 0.2, 0.3, 18, true, 0.6],
    ['stage25', 25, 0.6, 0.3, 18, false, 0.5],
    ['stage45', 45, -0.5, 0.2, 20, false, 0.4],
    ['stage75', 75, 0.4, 0.35, 18, false, 0.5],
    ['stage130', 130, 0.7, 0.25, 20, false, 0.5],
    ['stage230', 230, 0.5, 0.3, 18, false, 0.5],
];
await startServer(3177, { QA: '1' });
await startVite();
const browser = await launch();
try {
    const page = await open(browser, `http://localhost:${VITE_PORT}/`, { w: 1280, h: 720, q: Q });
    await sleep(2500);
    await qa(page, () => window.__qa.noWatch());
    await qa(page, () => window.__qa.give({ best: 400, cp: 400, tut: 9 }));
    await sleep(800);
    for (const [name, n, dyaw, pitch, dist, hud, walk] of SHOTS) {
        if (ONLY && ONLY !== name) continue;
        await qa(page, (h) => window.__qa.hud(h), hud);
        if (n > 0) await qa(page, (k) => window.__qa.toLanding(k), n);
        else await qa(page, () => window.__qa.teleport(-72.5, 1, 150, Math.PI));
        await sleep(1800);
        if (walk) { await qa(page, () => window.__qa.key('KeyW', true)); await sleep(walk * 1000); await qa(page, () => window.__qa.key('KeyW', false)); }
        await qa(page, ([dy, p, d]) => { const c = window.__qa; c.look(c.cam().yaw + dy, p, d); }, [dyaw, pitch, dist]);
        await sleep(1400);
        console.log(name, await shot(page, 'look-' + name));
    }
    console.log('errors', page.errors);
} finally {
    await browser.close();
    stopAll();
}
process.exit(0);
