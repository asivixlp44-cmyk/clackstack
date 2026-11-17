// Shaders compiled mid-game (they must all be warmed up behind the loading screen): climbs on the autopilot on the weak-laptop profile,
// logging the program count and every long frame. node tests/progwatch.mjs [secs]
import { startServer, startVite, stopAll, launch, open, qa, sleep, VITE_PORT } from './lib.mjs';

const SECS = +(process.argv[2] || 24);
await startServer(3177, { QA: '1' });
await startVite();
const browser = await launch();
try {
    const page = await open(browser, `http://localhost:${VITE_PORT}/`, { w: 1366, h: 768, q: 'low', cpu: 4 });
    await qa(page, () => window.__qa.noWatch(true));
    await sleep(1500);
    let last = await qa(page, () => window.__qa.state().programs);
    console.log('programs after load', last);
    await qa(page, () => { window.__qa.spikes(); window.__qa.close(); window.__qa.auto(true); });
    const t0 = Date.now();
    while (Date.now() - t0 < SECS * 1000) {
        await sleep(500);
        const s = await qa(page, () => ({ p: window.__qa.state().programs, st: window.__qa.state().stage, sp: window.__qa.spikes() }));
        if (s.p !== last || s.sp.length) console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', 'stage', s.st, 'programs', s.p, s.sp.length ? 'spikes ' + JSON.stringify(s.sp).slice(0, 300) : '');
        last = s.p;
    }
    console.log('errors', page.errors);
} finally {
    await browser.close();
    stopAll();
}
process.exit(0);
