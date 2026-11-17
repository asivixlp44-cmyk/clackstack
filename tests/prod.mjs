// The production build, real input only (no QA hooks in it): the game server serves client/dist; walk from the spawn to the first
// landing with the keys, then east up the first flight holding JUMP (the stage chip must say STAGE 2 and the Coins counter climb when you
// reach landing 2), bonk with a click, open and close a panel with the keyboard, check the console. Build first: npm run build.
// node tests/prod.mjs
import fs from 'node:fs';
import path from 'node:path';
import { startServer, stopAll, launch, sleep, shot, ROOT, TEST_PORT } from './lib.mjs';

const main = async () => {
    if (!fs.existsSync(path.join(ROOT, 'client', 'dist', 'index.html'))) throw new Error('build the client first (npm run build)');
    await startServer(TEST_PORT, {});
    const browser = await launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
    await page.setViewport({ width: 1280, height: 720 });
    const t0 = Date.now();
    await page.goto(`http://localhost:${TEST_PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#start').hidden, { timeout: 120000, polling: 200 });
    console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's; QA hooks present:', await page.evaluate(() => !!window.__qa));
    await sleep(1500);
    const coins = () => page.evaluate(() => +(document.querySelector('#coinVal').textContent || '0').replace(/,/g, ''));
    const stage = () => page.evaluate(() => document.querySelector('#stageNum').textContent);
    const c0 = await coins();
    await page.click('#view');
    // north to the first landing, then east up the flight, holding JUMP all the way
    await page.keyboard.down('Space');
    await page.keyboard.down('KeyW');
    await sleep(2900);
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyD');
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) { await sleep(250); reached = /STAGE 2/.test(await stage()); }
    await page.keyboard.up('KeyD');
    await page.keyboard.up('Space');
    await sleep(1500);
    const c1 = await coins();
    console.log('up the first flight:', await stage(), '· Coins', c0, '->', c1, reached && c1 > c0 ? 'OK (landing 2 reached, paid)' : 'FAIL');
    await shot(page, 'prod-landing2');
    // a click: the Bonk Glove swings (nobody near: a whiff, no error)
    for (let i = 0; i < 3; i++) { await page.mouse.click(640, 400); await sleep(500); }
    const hud = await page.evaluate(() => ({ quest: document.querySelector('#questLine').textContent, sub: document.querySelector('#stageSub').textContent }));
    console.log('hud', JSON.stringify(hud));
    // open and close a panel with the keyboard (G: the Gear Shop)
    await page.keyboard.press('KeyG');
    await sleep(500);
    const open = await page.evaluate(() => !document.querySelector('#modal').hidden);
    await page.keyboard.press('Escape');
    await sleep(300);
    console.log('Gear Shop opens with G:', open ? 'OK' : 'FAIL', '· closes with Esc:', await page.evaluate(() => document.querySelector('#modal').hidden) ? 'OK' : 'FAIL');
    // the stage picker: back to stage 1 with [
    await page.keyboard.press('BracketLeft');
    await sleep(1500);
    console.log('[ goes back a stage:', await stage(), /STAGE 1/.test(await stage()) ? 'OK' : 'FAIL');
    console.log('errors', JSON.stringify(errors));
    await browser.close();
    stopAll();
    process.exit(errors.length || !reached || !(c1 > c0) || !open ? 1 : 0);
};
main().catch((e) => { console.error(e); stopAll(); process.exit(1); });
