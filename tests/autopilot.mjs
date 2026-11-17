// The autopilot through a stage of every kind of obstacle, in the real game: for each kind, the first stage that has it; you're put on
// its landing and the autopilot climbs (hopping key to key, bouncing up cliffs, riding sliding keys, falling and starting again from the
// landing when a blink or a drop catches it) until it reaches the next landing. Prints the time each took and the falls.
// node tests/autopilot.mjs [kinds...]
import { startServer, startVite, stopAll, launch, open, qa, shot, sleep, TEST_PORT, VITE_PORT } from './lib.mjs';
import { buildStage } from '../shared/world.js';

const KINDS = process.argv.slice(2).length ? process.argv.slice(2) : ['stairs', 'holes', 'steps', 'leaps', 'narrow', 'bounce', 'ice', 'blink', 'slide', 'drop'];
const LIMIT = 90;
const pick = (kind) => { for (let n = 3; n < 200; n++) { const s = buildStage(n); if (s.segs.some((g) => g.type === kind)) return n; } return 0; };
await startServer(TEST_PORT, { QA: '1' });
await startVite();
const browser = await launch();
let bad = 0;
try {
    const page = await open(browser, `http://localhost:${VITE_PORT}/`, { w: 1280, h: 720, q: 'medium' });
    await qa(page, () => { window.__qa.noWatch(true); window.__qa.close(); });
    for (const kind of KINDS) {
        const n = pick(kind);
        await qa(page, (m) => window.__qa.give({ best: m, cp: m, tut: 9 }), n);
        await sleep(400);
        await qa(page, (m) => window.__qa.toLanding(m), n);
        await sleep(1500);
        const t0 = Date.now();
        await qa(page, () => window.__qa.auto(true));
        let st = null, falls = 0, lastY = 0;
        while ((Date.now() - t0) / 1000 < LIMIT) {
            await sleep(500);
            st = await qa(page, () => window.__qa.state());
            if (st.y < lastY - 25) falls++;
            lastY = st.y;
            if (st.best > n) break;
        }
        await qa(page, () => window.__qa.auto(false));
        const secs = ((Date.now() - t0) / 1000).toFixed(0), okd = st && st.best > n;
        if (!okd) { bad++; await shot(page, 'auto-stuck-' + kind); }
        console.log(`${kind.padEnd(7)} stage ${String(n).padStart(3)} [${buildStage(n).segs.map((g) => g.type).join(', ')}]: ${okd ? 'climbed in ' + secs + ' s' : 'NOT climbed in ' + LIMIT + ' s (at y ' + (st && st.y) + ')'}, ${falls} falls`);
        await qa(page, () => window.__qa.close());
    }
    const errs = [...page.errors, ...(await qa(page, () => window.__qa.errors()))];
    if (errs.length) { bad += errs.length; console.log('errors', errs.slice(0, 5)); }
} catch (e) { console.error(e); bad++; } finally { await browser.close(); stopAll(); }
console.log(bad ? bad + ' problems' : 'every kind climbed');
process.exit(bad ? 1 : 0);
