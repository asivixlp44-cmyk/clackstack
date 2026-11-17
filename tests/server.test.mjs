// Headless server test: the whole loop and its guards, against a running QA server (QA=1).
// Run: start the server with QA=1 PORT=3177 (cd server && set QA=1 && set PORT=3177 && node src/index.js), then: node tests/server.test.mjs [port]
// (or: node tests/server.test.mjs --spawn: it starts its own)
import { Client } from '../client/node_modules/@colyseus/sdk/build/index.mjs';
import { SPAWN, landingAt, landingTop, coinAt, buildStage, toWorld, respawnAt } from '../shared/world.js';
import { CFG, stageCoins, AGAIN_K, pickupCoins, SUMMIT_GEMS, skipGems, UPGRADES, upgradeCost, itemById, BOXES, restackNeed, restackGems, QUESTS } from '../shared/config.js';

const SPAWN_OWN = process.argv.includes('--spawn');
const PORT = Number(process.argv.find((a) => /^\d+$/.test(a))) || 3177;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log('  ok  ', what); } else { fail++; console.log('  FAIL', what); } };

async function join(name, uid) {
    const c = new Client('ws://localhost:' + PORT);
    const room = await c.joinOrCreate('tower', { uid: uid || 'test-' + Math.random().toString(36).slice(2), name });
    const st = { profile: null, toasts: [], snaps: 0, hello: null, msgs: {}, last: {}, all: {} };
    room.onMessage('hello', (m) => { st.hello = m; });
    room.onMessage('profile', (m) => { st.profile = m; });
    room.onMessage('lite', (m) => { if (st.profile) Object.assign(st.profile, m); });
    room.onMessage('toast', (m) => st.toasts.push(m.text));
    room.onMessage('snap', () => st.snaps++);
    for (const t of ['rush', 'pong', 'boards', 'reward', 'bought', 'taskdone', 'questdone', 'warped', 'broke', 'code', 'emote', 'chat', 'authed', 'landed', 'coin', 'summitfx', 'slapfx', 'bonked', 'hatched', 'restacked', 'spun', 'toastreward', 'adx2', 'adfail']) room.onMessage(t, (m) => { st.msgs[t] = (st.msgs[t] || 0) + 1; st.last[t] = m; (st.all[t] || (st.all[t] = [])).push(m); });
    for (let i = 0; i < 50 && !st.profile; i++) await sleep(50);
    return { room, st };
}
// stand somewhere: a QA teleport (where the server checks the next move from) and a move there
async function standAt(room, x, y, z) {
    room.send('qa', { tp: [x, y, z] });
    await sleep(70);
    room.send('move', { x, y, z, ry: 0, a: 0, ts: Date.now() });
    await sleep(70);
}
const onLandingAt = async (o, n) => { const a = landingAt(n); await standAt(o.room, a.x + 2, a.y, a.z - 1); };
async function want(o) { o.room.send('want', {}); await sleep(1100); o.room.send('want', {}); await sleep(250); return o.st.profile; }

const main = async () => {
    let proc = null;
    if (SPAWN_OWN) { const lib = await import('./lib.mjs'); proc = await lib.startServer(PORT, { QA: '1' }); }
    console.log('server test on port', PORT);
    // ----- join -----
    const A = await join('Alice');
    ok(A.st.profile && A.st.profile.coins === 0 && A.st.profile.best === 1 && A.st.profile.cp === 1, 'joined with a fresh profile at stage 1');
    const me = () => A.room.state.players.get(A.room.sessionId);
    ok(me() && Math.hypot(me().x - SPAWN.x, me().z - SPAWN.z) < 10, 'standing on the plaza by the start pad');
    // ----- a landing claimed from far away is refused -----
    A.room.send('cp', { n: 2 });
    await sleep(400);
    ok((await want(A)).best === 1, 'landing 2 claimed from the plaza: refused');
    // ----- on landing 2: a new landing pays -----
    await onLandingAt(A, 2);
    A.room.send('cp', { n: 2 });
    await sleep(500);
    let pr = await want(A);
    ok(pr.best === 2 && pr.cp === 2, 'landing 2 reached: best ' + pr.best);
    ok(pr.coins === stageCoins(2), 'it paid ' + pr.coins + ' Coins (' + stageCoins(2) + ' expected)');
    ok(A.st.last.landed && A.st.last.landed.n === 2 && !A.st.last.landed.win, 'told: stage 1 cleared');
    // ----- skipping landings: refused -----
    await onLandingAt(A, 4);
    A.room.send('cp', { n: 4 });
    await sleep(400);
    ok((await want(A)).best === 2, 'landing 4 straight after 2: refused');
    // (back where we really are)
    A.room.send('respawn', {});
    await sleep(400);
    // ----- coins -----
    const c0 = coinAt(1, 0);
    await standAt(A.room, c0.x, c0.y - 2.5, c0.z);
    A.room.send('coin', { n: 1, i: 0 });
    await sleep(300);
    pr = await want(A);
    const gotCoin = pr.coins - stageCoins(2);
    ok(pr.pickups === 1 && (gotCoin === pickupCoins(1) || gotCoin === pickupCoins(1) * 5), 'a floating coin of stage 1: +' + gotCoin);
    A.room.send('coin', { n: 1, i: 0 });
    await sleep(300);
    ok((await want(A)).pickups === 1, 'the same coin again straight away: refused');
    A.room.send('coin', { n: 1, i: 3 });
    await sleep(300);
    ok((await want(A)).pickups === 1, 'a coin across the flight: refused');
    const c9 = coinAt(9, 0);
    await standAt(A.room, c9.x, c9.y - 2.5, c9.z);
    A.room.send('coin', { n: 9, i: 0 });
    await sleep(300);
    ok((await want(A)).pickups === 1, 'a coin on a stage you haven\'t reached: refused');
    // ----- moves: too far, too fast up -----
    await onLandingAt(A, 2);
    const s0 = A.st.snaps;
    A.room.send('move', { x: 200, y: landingTop(2), z: 200, ry: 0, a: 0, ts: Date.now() });
    await sleep(400);
    ok(A.st.snaps > s0, 'a move 200 studs away: snapped back');
    const s1 = A.st.snaps, a2 = landingAt(2);
    A.room.send('move', { x: a2.x, y: a2.y + 150, z: a2.z, ry: 0, a: 2, ts: Date.now() });
    await sleep(400);
    ok(A.st.snaps > s1, 'rising 150 studs at once: snapped back');
    // ----- a Summit: the landing after stage 10 -----
    A.room.send('qa', { best: 10, cp: 10 });
    await sleep(200);
    await onLandingAt(A, 11);
    const g0 = (await want(A)).gems;
    A.room.send('cp', { n: 11 });
    await sleep(500);
    pr = await want(A);
    ok(pr.best === 11 && pr.wins === 1 && pr.summits === 1, 'landing 11: a Summit, 1 Win');
    ok(pr.gems === g0 + SUMMIT_GEMS, 'and ' + SUMMIT_GEMS + ' Gems (' + (pr.gems - g0) + ')');
    ok(A.st.last.landed && A.st.last.landed.win, 'told: a Summit');
    // ----- the stage picker -----
    A.room.send('goto', { n: 5 });
    await sleep(500);
    pr = await want(A);
    ok(pr.cp === 5 && A.st.last.warped && Math.abs(A.st.last.warped.y - landingTop(5)) < 0.5, 'back to landing 5 (warped to y ' + (A.st.last.warped && A.st.last.warped.y) + ')');
    await sleep(700);
    A.room.send('goto', { n: 40 });
    await sleep(500);
    ok((await want(A)).cp === 5, 'a landing past your best: refused');
    // ----- climbing again pays a little -----
    await onLandingAt(A, 6);
    const cB = pr.coins;
    A.room.send('cp', { n: 6 });
    await sleep(500);
    pr = await want(A);
    ok(pr.cp === 6 && pr.coins - cB === Math.round(stageCoins(6) * AGAIN_K), 'landing 6 again: +' + (pr.coins - cB) + ' (' + Math.round(stageCoins(6) * AGAIN_K) + ' expected)');
    // ----- SKIP with Gems: only from your best -----
    A.room.send('qa', { gems: 100 });
    await sleep(150);
    A.room.send('skip', {});
    await sleep(400);
    pr = await want(A);
    ok(pr.best === 11, 'SKIP away from your best stage: refused');
    A.room.send('goto', { n: 11 });
    await sleep(700);
    const gS = (await want(A)).gems;
    A.room.send('skip', {});
    await sleep(500);
    pr = await want(A);
    ok(pr.best === 12 && pr.cp === 12 && pr.gems === gS - skipGems(11), 'skipped stage 11 for ' + skipGems(11) + ' Gems: best ' + pr.best);
    // ----- the Gear Shop -----
    A.room.send('qa', { coins: 200000 });
    await sleep(150);
    A.room.send('upgrade', { id: 'jump' });
    await sleep(300);
    pr = await want(A);
    ok(pr.ups.jump === 1, 'bought Boing Boots (' + upgradeCost(UPGRADES[0], 0) + ' Coins)');
    A.room.send('item', { id: 'double' });
    await sleep(300);
    pr = await want(A);
    ok(pr.items.double === 1, 'bought the Double Jump (' + itemById.double.coins + ' Coins)');
    const cI = pr.coins;
    A.room.send('item', { id: 'double' });
    await sleep(300);
    ok((await want(A)).coins === cI, 'buying it again costs nothing');
    A.room.send('qa', { gems: 200 });
    await sleep(150);
    A.room.send('item', { id: 'rainbow' });
    await sleep(300);
    pr = await want(A);
    ok(pr.items.rainbow === 1, 'the Rainbow Glove for ' + itemById.rainbow.gems + ' Gems');
    A.room.send('trail', { id: 'pink' });
    await sleep(300);
    pr = await want(A);
    ok(pr.trails.pink && pr.trail === 'pink' && me().trail === 'pink', 'a pink trail, on (everyone sees it)');
    A.room.send('trail', { id: '' });
    await sleep(300);
    ok((await want(A)).trail === '', 'and off again');
    // ----- Capsules -----
    A.room.send('box', { id: BOXES[0].id, n: 3 });
    await sleep(400);
    pr = await want(A);
    ok(pr.caps === 3 && pr.team.length === 3, 'opened 3 Pastel Capsules: a team of ' + pr.team.length);
    A.room.send('qa', { gems: -pr.gems });
    await sleep(150);
    A.room.send('box', { id: 'g1', n: 1 });
    await sleep(400);
    ok(A.st.last.broke && A.st.last.broke.cur === 'gems', 'the Rainbow Capsule with no Gems: not enough');
    // ----- bonks: a second player -----
    const B = await join('Bob');
    await sleep(300);
    ok(B.room.state.players.has(A.room.sessionId), 'Bob sees Alice on the tower');
    const humans = [...B.room.state.players.values()].filter((p) => !p.bot).length;
    ok(humans === 2, 'two players on the tower (' + humans + ', plus ' + ([...B.room.state.players.values()].length - humans) + ' bots)');
    // both on stage 1's flight, a few studs apart
    const st1 = buildStage(1), k5 = st1.pathKey[10], w5 = toWorld(1, k5.u, k5.v);
    await standAt(A.room, w5.x - 3, k5.top, w5.z);
    await standAt(B.room, w5.x + 2, k5.top, w5.z);
    A.room.send('slap', { s: B.room.sessionId });
    await sleep(400);
    ok(B.st.last.bonked && B.st.last.bonked.from === 'Alice', 'Alice bonks Bob: he\'s knocked flying');
    ok(A.st.last.slapfx && B.st.last.slapfx, 'everyone sees the bonk');
    const nB = B.st.msgs.bonked;
    A.room.send('slap', { s: B.room.sessionId });
    await sleep(300);
    ok(B.st.msgs.bonked === nB, 'a second bonk straight away: refused (cooldown)');
    await sleep(CFG.slapGap * 1000);
    await onLandingAt(B, 1);
    const la = landingAt(1);
    await standAt(A.room, la.x - 4, la.y, la.z);
    A.room.send('slap', { s: B.room.sessionId });
    await sleep(400);
    ok(B.st.msgs.bonked === nB && A.st.toasts.some((t) => /safe/i.test(t)), 'nobody can be bonked on a landing');
    pr = await want(A);
    ok(pr.bonks === 1, 'Alice has 1 bonk');
    // ----- Restack -----
    A.room.send('restack', {});
    await sleep(300);
    pr = await want(A);
    ok(pr.restacks === 0, 'Restack is refused before stage ' + restackNeed(0));
    A.room.send('qa', { best: restackNeed(0) });
    await sleep(200);
    const gR = (await want(A)).gems;
    A.room.send('restack', {});
    await sleep(500);
    pr = await want(A);
    ok(pr.restacks === 1 && pr.best === 1 && pr.cp === 1 && pr.coins === 0, 'restacked: back to stage 1 with no Coins');
    ok(pr.ups.jump === 1 && pr.items.double === 1 && pr.team.length === 3 && pr.top >= restackNeed(0) && pr.gems === gR + restackGems(0), 'upgrades, gear, Pals and the top stage kept, +' + restackGems(0) + ' Gems');
    // a landing now pays x1.5
    await onLandingAt(A, 2);
    A.room.send('cp', { n: 2 });
    await sleep(500);
    pr = await want(A);
    const palK = pr.team.reduce((m, id) => m, 1);
    ok(pr.coins >= Math.round(stageCoins(2) * 1.5) * palK, 'after a Restack landing 2 pays more (' + pr.coins + ')');
    // ----- RAINBOW RUSH -----
    A.room.send('qa', { rush: 1 });
    await sleep(300);
    ok(A.st.msgs.rush && B.st.msgs.rush, 'a Rainbow Rush: everyone is told');
    // ----- quests, codes, daily -----
    A.room.send('code', { code: 'CLACKSTACK' });
    await sleep(250);
    A.room.send('code', { code: 'CLACKSTACK' });
    await sleep(250);
    pr = await want(A);
    ok(pr.codes.CLACKSTACK && A.st.last.code && A.st.last.code.ok === false, 'a code works once');
    const qi0 = pr.qi;
    A.room.send('qclaim', {});
    await sleep(300);
    pr = await want(A);
    ok(pr.qi === qi0 + 1, 'claimed the quest "' + QUESTS[qi0].text + '"');
    A.room.send('daily', {});
    A.room.send('daily', {});
    await sleep(300);
    pr = await want(A);
    ok(pr.daily && pr.daily.streak === 1, 'the daily reward, once a day');
    // ----- the bots climb -----
    const bot = [...B.room.state.players.values()].find((p) => p.bot);
    if (bot) {
        const y0 = bot.y, x0 = bot.x, z0 = bot.z;
        await sleep(4000);
        ok(Math.hypot(bot.x - x0, bot.z - z0) + Math.abs(bot.y - y0) > 3, 'a bot is on the move up the tower (' + bot.name + ')');
    }
    A.room.leave(); B.room.leave();
    await sleep(300);
    void respawnAt;
    console.log(`\n${pass} passed, ${fail} failed`);
    if (proc) proc.kill();
    process.exit(fail ? 1 : 0);
};
main().catch((e) => { console.error(e); process.exit(1); });
