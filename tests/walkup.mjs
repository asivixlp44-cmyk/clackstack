// Walking up the stairs in the browser, real keys only and JUMP never pressed: from the spawn north to the first landing, then east up the
// whole first flight (plain stairs) to landing 2. node tests/walkup.mjs
import { startServer, startVite, stopAll, launch, open, qa, sleep, VITE_PORT } from './lib.mjs';

await startServer(3177, { QA: '1' });
await startVite();
const browser = await launch();
let ok = false;
try {
    const page = await open(browser, `http://localhost:${VITE_PORT}/`, { w: 1280, h: 720, q: 'medium' });
    await sleep(2500);
    await qa(page, () => { window.__qa.noWatch(); window.__qa.close(); });
    await page.click('#view');
    await page.keyboard.down('KeyW'); await sleep(2900); await page.keyboard.up('KeyW');
    const s0 = await qa(page, () => window.__qa.state());
    console.log('at the first landing:', { y: s0.y, stage: s0.stage });
    await page.keyboard.down('KeyD');
    let maxY = s0.y, jumps = 0, lastGround = true;
    for (let i = 0; i < 60; i++) {
        await sleep(150);
        const s = await qa(page, () => window.__qa.state());
        maxY = Math.max(maxY, s.y);
        if (lastGround && !s.onGround && s.y > maxY - 0.1) jumps++;
        lastGround = s.onGround;
        if (s.best >= 2) { ok = true; console.log('landing 2 reached walking:', { y: s.y, best: s.best, secs: ((i + 1) * 0.15).toFixed(1) }); break; }
    }
    await page.keyboard.up('KeyD');
    if (!ok) console.log('stuck at', await qa(page, () => window.__qa.state()));
    console.log(ok ? 'PASS: walked up the first flight without jumping' : 'FAIL', '· errors', page.errors);
} finally {
    await browser.close();
    stopAll();
}
process.exit(ok ? 0 : 1);
