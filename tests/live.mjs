// The live game, once it's hosted: opens https://clackstack.play.bloxity.io in Chrome, waits until it has joined a server, notes where its
// socket went (a pod's address from the matchmaker, never clackstack.host.bloxity.io), walks a few steps with real keys, and lists console
// errors. node tests/live.mjs [url]
import { launch, sleep, shot } from './lib.mjs';

const URL = process.argv[2] || 'https://clackstack.play.bloxity.io/';
const browser = await launch();
let ok = false;
try {
    const page = await browser.newPage();
    const errors = [], sockets = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    cdp.on('Network.webSocketCreated', (e) => sockets.push(e.url.replace(/\?.*/, '')));
    await page.setViewport({ width: 1280, height: 720 });
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#start') && document.querySelector('#start').hidden, { timeout: 90000, polling: 250 });
    console.log('in the game after', ((Date.now() - t0) / 1000).toFixed(1), 's');
    await sleep(2500);
    const hud = () => page.evaluate(() => ({ stage: document.querySelector('#stageNum')?.textContent, coins: document.querySelector('#coinVal')?.textContent, quest: document.querySelector('#questLine')?.textContent }));
    console.log('hud', await hud());
    await page.click('#view');
    await page.keyboard.down('KeyW'); await sleep(1500); await page.keyboard.up('KeyW');
    await sleep(800);
    console.log('after walking', await hud());
    console.log('sockets', sockets);
    const viaHost = sockets.some((s) => /\.host\.bloxity\.io/.test(s));
    await shot(page, 'live');
    ok = sockets.length > 0 && !viaHost;
    console.log(ok ? 'LIVE OK' : 'PROBLEM', viaHost ? '(a socket went to the host route!)' : '', '· errors', errors);
} finally {
    await browser.close();
}
process.exit(ok ? 0 : 1);
