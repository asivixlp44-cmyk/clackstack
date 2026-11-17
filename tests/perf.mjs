// Frame rates where it matters: at the spawn (the plaza and the whole tower in view), climbing on the autopilot (keys pressing, coins,
// the chunks building as you go up), and high up over the sea of clouds, with the bots about, on a desktop (Medium), a simulated weak
// laptop (Low, 1366x768, CPU throttled 4x) and a phone in portrait (Low). LOW_GPU=1 runs Chrome on the integrated chip.
// node tests/perf.mjs
import { startServer, startVite, stopAll, launch, open, qa, sleep, measure, TEST_PORT, VITE_PORT } from './lib.mjs';

const PROFILES = [
    { name: 'desktop Medium', o: { w: 1600, h: 900, q: 'medium' } },
    { name: 'weak laptop Low, 4x CPU', o: { w: 1366, h: 768, q: 'low', cpu: 4 } },
    { name: 'phone portrait Low', o: { w: 390, h: 844, dpr: 2, touch: true, q: 'low' } },
];
const main = async () => {
    await startServer(TEST_PORT, { QA: '1' });
    await startVite();
    const browser = await launch();
    for (const P of PROFILES) {
        const page = await open(browser, `http://localhost:${VITE_PORT}/`, P.o);
        await qa(page, (phone) => { window.__qa.noWatch(true); if (!phone) window.__qa.noPace(); }, /phone/.test(P.name));
        await sleep(2500);
        const spawn = await measure(page, 5);
        await qa(page, () => { window.__qa.close(); window.__qa.auto(true); });
        await sleep(6000);
        const climb = await measure(page, 8);
        const sec = await qa(page, () => window.__qa.sections());
        // high up: over the clouds, a lap of flights above and below
        await qa(page, () => { window.__qa.auto(false); window.__qa.give({ best: 41, cp: 40 }); });
        await sleep(400);
        await qa(page, () => { window.__qa.toLanding(40); });
        await sleep(2500);
        await qa(page, () => window.__qa.auto(true));
        await sleep(3000);
        const high = await measure(page, 6);
        const st = await qa(page, () => window.__qa.state());
        console.log(`${P.name.padEnd(26)} load ${page.loadSecs.toFixed(1)} s | spawn ${spawn.fps} fps (p95 ${spawn.p95} ms, calls ${spawn.calls}, tris ${spawn.tris}) | climbing ${climb.fps} fps (p95 ${climb.p95} ms, >50ms ${climb.over50}, work ${climb.avgMs} ms, calls ${climb.calls}, tris ${climb.tris}) | stage 40 ${high.fps} fps (p95 ${high.p95} ms, >50ms ${high.over50}, calls ${high.calls}, tris ${high.tris}) | ${JSON.stringify(sec)} | best ${st.best}`);
        console.log('   errors', JSON.stringify(page.errors));
        await page.browserContext().close();
    }
    await browser.close();
    stopAll();
    process.exit(0);
};
main().catch((e) => { console.error(e); stopAll(); process.exit(1); });
