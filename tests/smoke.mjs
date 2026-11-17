// A quick look at the whole loop in a browser: the plaza and the tower from the spawn, the autopilot walking onto the first landing and
// climbing (landings reached, coins grabbed), a Summit, a Rainbow Rush, high up in the sky, the tools, the panels, a Capsule, with
// screenshots and console errors.
// node tests/smoke.mjs [portrait]
import { startServer, startVite, stopAll, launch, open, qa, shot, sleep, TEST_PORT, VITE_PORT, OUT } from './lib.mjs';

const portrait = process.argv.includes('portrait');
const main = async () => {
    await startServer(TEST_PORT, { QA: '1' });
    await startVite();
    const browser = await launch();
    const page = await open(browser, `http://localhost:${VITE_PORT}/`, portrait ? { w: 390, h: 844, dpr: 2, touch: true } : { w: 1280, h: 720 });
    console.log('loaded in', page.loadSecs.toFixed(1), 's');
    const tag = portrait ? 'p-' : '';
    await sleep(1500);
    console.log('state', JSON.stringify(await qa(page, () => window.__qa.state())));
    await shot(page, tag + '01-spawn');
    await qa(page, () => window.__qa.look(Math.PI, 0.3, 26));
    await sleep(600);
    await shot(page, tag + '02-plaza');
    await qa(page, () => window.__qa.look(0, 0.2, 24));
    // the autopilot: to the first landing and up
    await qa(page, () => window.__qa.auto(true));
    for (let k = 0; k < 10; k++) {
        await sleep(3000);
        const st = await qa(page, () => window.__qa.state());
        console.log('auto', JSON.stringify({ x: st.x, y: st.y, z: st.z, best: st.best, cp: st.cp, coins: st.coins, pickups: st.pickups, chunks: st.chunks }));
        if (k === 2) await shot(page, tag + '03-climbing');
        if (k === 6) await shot(page, tag + '04-climbing-higher');
    }
    await qa(page, () => window.__qa.auto(false));
    // a Summit: the landing after stage 10
    await qa(page, () => { window.__qa.give({ best: 10, cp: 10 }); });
    await sleep(400);
    await qa(page, () => window.__qa.toLanding(10));
    await sleep(800);
    await qa(page, () => window.__qa.auto(true));
    for (let k = 0; k < 14; k++) { await sleep(2500); const st = await qa(page, () => window.__qa.state()); if (st.best >= 11) break; }
    await sleep(600);
    await shot(page, tag + '05-summit');
    console.log('after summit', JSON.stringify(await qa(page, () => window.__qa.state())));
    await qa(page, () => window.__qa.close());
    // RAINBOW RUSH
    await qa(page, () => window.__qa.give({ rush: 1 }));
    await sleep(2200);
    await shot(page, tag + '06-rush');
    await qa(page, () => window.__qa.auto(false));
    // high up: above the clouds, golden hour, sunset, twilight, space
    for (const n of [33, 64, 95, 125, 170, 215]) {
        await qa(page, (m) => { window.__qa.give({ best: m + 1, cp: m }); }, n);
        await sleep(300);
        await qa(page, (m) => window.__qa.toLanding(m), n);
        await sleep(2600);
        await qa(page, () => window.__qa.look(0.6, 0.25, 26));
        await sleep(900);
        await shot(page, tag + '07-sky-' + n);
    }
    // tools
    await qa(page, () => window.__qa.give({ items: ['double', 'carpet', 'hop', 'rainbow'], coins: 50000, gems: 500 }));
    await sleep(500);
    await qa(page, () => window.__qa.tool('hop'));
    await sleep(500);
    await shot(page, tag + '08-hop');
    await sleep(1500);
    // the panels
    for (const p of ['shop', 'pals', 'quests', 'spin', 'restack', 'stages', 'daily', 'ranks', 'settings', 'gifts']) {
        await qa(page, (k) => window.__qa.panel(k), p);
        await sleep(450);
        await shot(page, tag + '10-panel-' + p);
        await qa(page, () => window.__qa.close());
    }
    for (const t of ['gear', 'trails', 'gems']) { await qa(page, (k) => window.__qa.panel('shop', k), t); await sleep(400); await shot(page, tag + '10-shop-' + t); await qa(page, () => window.__qa.close()); }
    // a Capsule on the plaza
    await qa(page, () => window.__qa.give({ cp: 1 }));
    await sleep(300);
    await qa(page, () => window.__qa.teleport(-10, 0, 180, 0));
    await sleep(800);
    await qa(page, () => window.__qa.hatch('c1', 3));
    await sleep(1600);
    await shot(page, tag + '11-hatch');
    await qa(page, () => window.__qa.close());
    await sleep(1000);
    await qa(page, () => window.__qa.look(Math.PI * 0.85, 0.25, 16));
    await sleep(800);
    await shot(page, tag + '12-pals');
    console.log('perf', JSON.stringify(await qa(page, () => window.__qa.perf())));
    console.log('diag', JSON.stringify(await qa(page, () => window.__qa.diag())));
    console.log('errors', JSON.stringify(page.errors.concat(await qa(page, () => window.__qa.errors()))));
    console.log('shots in', OUT);
    await browser.close();
    stopAll();
    process.exit(0);
};
main().catch((e) => { console.error(e); stopAll(); process.exit(1); });
