// The first sessions, simulated a stage at a time with the real formulas (shared/config.js): a typical player climbing (a stage takes
// longer the higher it is, less with Boing Boots, Zoom Sneakers, the Double Jump, the Cloud Carpet and Rocket Hop; now and then a fall
// costs half a stage), grabbing most of each stage's floating coins, claiming quests, gifts and the daily reward, and spending greedily
// (upgrades, gear, Capsules, a Restack when it opens). It prints what comes when. node tests/economy.mjs [minutes]
import {
    CFG, stageCoins, pickupCoins, coinMult, isSummit, SUMMIT_GEMS, UPGRADES, upgradeCost, ITEMS, BOXES, BUDDIES, ODDS, teamSize, restackNeed, restackGems,
    QUESTS, GIFTS, rewardFor, DAILY,
} from '../shared/config.js';

const MINS = +(process.argv[2] || 45);
const p = { coins: 0, gems: 0, wins: 0, best: 1, top: 1, restacks: 0, ups: {}, items: { glove: 1 }, buds: {}, team: [], caps: 0, pickups: 0, summits: 0, qi: 0, upgrades: 0 };
let t = 0, rng = 7;
const R = () => { rng = (rng * 16807) % 2147483647; return rng / 2147483647; };
const log = [];
const say = (s) => log.push(String(Math.floor(t / 60)).padStart(2) + ':' + String(Math.floor(t % 60)).padStart(2, '0') + '  ' + s);
const lvl = (id) => p.ups[id] || 0;
// seconds to climb stage n
function stageTime(n) {
    let s = 20 + n * 0.22;
    s /= 1 + 0.05 * lvl('speed') + 0.04 * lvl('jump');
    if (p.items.double) s *= 0.85;
    if (p.items.carpet) s *= 0.94;
    if (p.items.hop) s *= 0.9;
    return s;
}
function give(r) { const g = rewardFor(p, r); p.coins += g.coins || 0; p.gems += g.gems || 0; }
function qv(kind) { if (kind === 'double' || kind === 'carpet' || kind === 'hop') return p.items[kind] ? 1 : 0; return p[kind] || 0; }
function spend() {
    for (let guard = 0; guard < 40; guard++) {
        const opts = [];
        for (const u of UPGRADES) { const n = lvl(u.id); if (n < u.max) opts.push({ c: upgradeCost(u, n), go: () => { p.ups[u.id] = n + 1; p.upgrades++; if (n === 0) say('upgrade ' + u.name); } }); }
        // gear: saved up for (the next piece of gear is bought before anything that costs more than a fifth of it)
        const gear = ITEMS.find((it) => !it.free && !it.gems && !p.items[it.id]);
        if (gear) opts.push({ c: gear.coins, w: 0.2, go: () => { p.items[gear.id] = 1; say('GEAR ' + gear.name + ' (' + gear.coins + ')'); } });
        // a Capsule: the best one you can afford a few of (a dozen of each kind, chasing the rare ones)
        const box = [...BOXES].reverse().find((b) => !b.gems && p.coins >= b.cost * 3 && (p['cap_' + b.id] || 0) < 12);
        if (box) opts.push({ c: box.cost, w: 1.6, go: () => {
            p['cap_' + box.id] = (p['cap_' + box.id] || 0) + 1;
            let r = R() * ODDS.reduce((a, x) => a + x, 0), j = 0;
            for (; j < 3; j++) { r -= ODDS[j]; if (r < 0) break; }
            const id = box.buds[j];
            p.buds[id] = (p.buds[id] || 0) + 1; p.caps++;
            const all = []; for (const k of BUDDIES) for (let i = 0; i < Math.min(p.buds[k.id] || 0, 6); i++) all.push(k);
            all.sort((a, b) => b.mult - a.mult); p.team = all.slice(0, teamSize(p)).map((k) => k.id);
            if (p.caps === 1 || p.caps % 10 === 0) say('capsule #' + p.caps + ' (' + box.name + ') · Coins x' + coinMult(p, false, false).toFixed(2));
        } });
        opts.sort((a, b) => a.c * (a.w || 1) - b.c * (b.w || 1));
        // (the cheapest-weighted first; when that's the gear and it's out of reach, keep saving: only what costs under a fifth of it)
        const first = opts[0];
        const o = first && first.c > p.coins && first.w === 0.2 ? opts.find((x) => x.c <= p.coins && x.c < first.c * 0.2) : opts.find((x) => x.c <= p.coins);
        if (!o) return;
        p.coins -= o.c; o.go();
    }
}
let gi = 0, daily = 0;
give(DAILY[0]); daily = 1;
while (t < MINS * 60) {
    const n = p.best, dt = stageTime(n);
    t += dt;
    // a fall now and then: half a stage again
    if (R() < Math.min(0.45, 0.06 + n * 0.004) / (p.items.carpet ? 1.6 : 1)) t += dt * 0.5;
    // the stage's floating coins (most of them) and the new landing
    const m = coinMult(p, false, R() < 0.08);
    const got = Math.round((pickupCoins(n) * 3 + stageCoins(n + 1)) * m);
    p.coins += got; p.pickups += 3;
    // ENTER keys on the way (from stage 7), a bonk now and then (the bots are always about)
    if (n >= 7 && R() < 0.3) p.bounces = (p.bounces || 0) + 1;
    if (R() < 0.25) p.bonks = (p.bonks || 0) + 1;
    p.best = n + 1; p.top = Math.max(p.top, p.best);
    if (isSummit(p.best)) { p.wins++; p.summits++; p.gems += SUMMIT_GEMS; say('SUMMIT ' + p.summits + ' (stage ' + p.best + ') · ' + p.coins + ' Coins'); }
    // quests, gifts
    while (p.qi < QUESTS.length && qv(QUESTS[p.qi].kind) >= QUESTS[p.qi].n) { give(QUESTS[p.qi]); p.qi++; }
    while (gi < GIFTS.length && t >= GIFTS[gi].min * 60) { give(GIFTS[gi]); gi++; }
    spend();
    // Restack when it opens (after the first one: once the next Capsule's out of reach anyway)
    if (p.best >= restackNeed(p.restacks)) {
        p.gems += restackGems(p.restacks); p.restacks++; p.coins = 0; p.best = 1;
        say('RESTACK ' + p.restacks + ' · Coins x' + (1 + 0.5 * p.restacks) + ' for good (top stage ' + p.top + ')');
    }
}
console.log(log.join('\n'));
console.log(`\nafter ${MINS} min: top stage ${p.top}, ${p.summits} Summits, ${p.restacks} Restacks, ${p.upgrades} upgrades, gear: ${Object.keys(p.items).join(', ')}, ${p.caps} Capsules (Coins x${coinMult(p, false, false).toFixed(2)}), ${p.gems} Gems, quest ${p.qi}/${QUESTS.length}`);
void CFG; void daily;
