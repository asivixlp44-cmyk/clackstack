// Materials shared by objects of different kinds (three.js recomputes their shader at every switch, every frame): at the plaza and
// climbing. node tests/mats.mjs
import { startServer, startVite, stopAll, launch, open, qa, sleep, VITE_PORT } from './lib.mjs';

await startServer(3177, { QA: '1' });
await startVite();
const browser = await launch();
try {
    const page = await open(browser, `http://localhost:${VITE_PORT}/`, { w: 1280, h: 720, q: 'low' });
    await sleep(2500);
    console.log('plaza:', await qa(page, () => window.__qa.mats()));
    console.log('plaza shader work:', JSON.stringify(await qa(page, () => window.__qa.progCalls(3))));
    await qa(page, () => { window.__qa.give({ best: 40, cp: 30, tut: 9 }); });
    await sleep(300);
    await qa(page, () => window.__qa.toLanding(30));
    await sleep(2500);
    console.log('stage 30:', await qa(page, () => window.__qa.mats()));
    await qa(page, () => window.__qa.auto(true));
    console.log('climbing shader work:', JSON.stringify(await qa(page, () => window.__qa.progCalls(3))));
    console.log('errors', page.errors);
} finally {
    await browser.close();
    stopAll();
}
process.exit(0);
