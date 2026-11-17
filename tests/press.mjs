// The key press, frame by frame: stand on a key (it's down, you're down with it), jump off (it springs back up past the top and settles),
// land on the next (it bottoms out, a squash). Screenshots of each moment, and the key's height read back from the shader's formula.
// node tests/press.mjs
import { startServer, startVite, stopAll, launch, open, qa, shot, sleep, VITE_PORT } from './lib.mjs';

await startServer(3177, { QA: '1' });
await startVite();
const browser = await launch();
try {
    const page = await open(browser, `http://localhost:${VITE_PORT}/`, { w: 1280, h: 720, q: 'high' });
    await sleep(2500);
    await qa(page, () => window.__qa.noWatch());
    await qa(page, () => window.__qa.give({ best: 40, cp: 2, tut: 9 }));
    await qa(page, () => window.__qa.hud(false));
    await qa(page, () => window.__qa.toLanding(2));
    await sleep(1500);
    // walk onto the stairs and stop on a key
    await qa(page, () => window.__qa.key('KeyW', true)); await sleep(700); await qa(page, () => window.__qa.key('KeyW', false));
    await sleep(900);
    await qa(page, () => { const c = window.__qa; c.look(c.cam().yaw + 1.45, 0.05, 11); });
    await sleep(600);
    console.log('standing', await qa(page, () => window.__qa.state()));
    await shot(page, 'press-1-standing');
    await qa(page, () => window.__qa.jump());
    await sleep(70); await shot(page, 'press-2-jumped-70ms');
    await sleep(80); await shot(page, 'press-3-jumped-150ms');
    await sleep(450); await shot(page, 'press-4-landed');
    console.log('errors', page.errors);
} finally {
    await browser.close();
    stopAll();
}
process.exit(0);
