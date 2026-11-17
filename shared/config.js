// Clackstack: the game's data and formulas, shared by the client and the server.
// The loop: an endless tower of giant keycaps. Flights of keys wind up round the outside of the Stack, a colossal pillar that rises
// through the clouds and on into space; every flight is a stage, every corner landing a checkpoint. Climb: every new landing pays Coins,
// every tenth stage is a Summit that pays a Win. Coins buy Boing Boots, Zoom Sneakers, the Cloud Carpet, Rocket Hop and Pal Capsules;
// Restack (back to stage 1) for a Coin multiplier that stays. Everything is bought with Coins or Gems, both earned in the game. There are
// no in-app purchases.
export const lookup = (o) => Object.assign(Object.create(null), o);

export const CFG = {
    maxPlayers: 16,
    // moving: walk speed, gravity, the fastest fall, a jump's power (studs: jumpH), the hop's speed (a jump let go early)
    walk: 24, grav: 110, fallMax: 210, airDash: 46, hopV: 22, power: 62,
    // the Cloud Carpet: JUMP held on the way down floats you at this speed; the Double Jump's second jump is this much of the first
    glideFall: 8, airJumpK: 0.82,
    // Rocket Hop: straight up at this speed, once in this long; a bounce key launches you at this speed
    hopBoostV: 92, hopGap: 9, bounceV: 74,
    // the Bonk Glove: this far, this hard, once in this long (the Rainbow Glove: harder)
    slapReach: 10, slapPush: 46, slapLift: 20, slapGap: 1.3, rainbowPush: 66,
    // fall this far below your checkpoint and you're put back on it
    fallBelow: 46,
    // the server keeps this many bots climbing when it's quiet (one leaves per player who joins)
    bots: 3,
    boostX2Gems: 25, boostX2Mins: 15, adX2Mins: 10,
    spinMins: 7, spinMax: 3,
    // RAINBOW RUSH: every few minutes (while someone real is here) every Coin pays this much more, for a while
    rushEvery: [200, 320], rushSecs: 30, rushMult: 3,
    // a stage's coins come back for you this long after you took them
    coinBack: 90,
};

// ----- jump power -> height (studs) -----
export const jumpH = (p) => Math.max(0, p) * Math.max(0, p) / 392;
export const jumpV = (p) => Math.sqrt(2 * CFG.grav * jumpH(p));

// ----- the zones: ten stages each. An evening mechanical keyboard, two-tone: graphite caps (keys[0]), light grey caps (keys[2]) and
// one accent cap colour (keys[1]), the pedestals under them near-black (riser), the tower's case (wall), the landing plate (land), and
// the zone's LED colour (led): the backlit legends, the light under every key, the strips up the tower. Past the last zone they go round
// again, a little deeper each time -----
export const ZONES = [
    { id: 'bubble', name: 'Crimson Switch', keys: [0x403840, 0xb0203e, 0xdcd2d6], riser: 0x1e1a1e, wall: 0x3a3236, land: 0x4a4046, led: 0xff2d55, sound: 'pop' },
    { id: 'peach', name: 'Ember Row', keys: [0x413a36, 0xc04a16, 0xdcd4ce], riser: 0x1f1b18, wall: 0x3b3430, land: 0x4b423c, led: 0xff6a1a, sound: 'membrane' },
    { id: 'lemon', name: 'Amber Deck', keys: [0x403c33, 0xc08a10, 0xdcd8cc], riser: 0x1e1c16, wall: 0x3a372e, land: 0x4a463a, led: 0xffc21a, sound: 'clack' },
    { id: 'lime', name: 'Venom Keys', keys: [0x3a4035, 0x5e9612, 0xd4dccc], riser: 0x1a1e16, wall: 0x343a2f, land: 0x434a3d, led: 0x9aff1a, sound: 'pop' },
    { id: 'mint', name: 'Emerald Grid', keys: [0x35403a, 0x129658, 0xccdcd4], riser: 0x161e1a, wall: 0x2f3a34, land: 0x3d4a43, led: 0x1aff8a, sound: 'thock' },
    { id: 'aqua', name: 'Cyan Circuit', keys: [0x353e42, 0x0e8299, 0xccdadc], riser: 0x161c1f, wall: 0x2f383b, land: 0x3d474b, led: 0x1ae0ff, sound: 'crystal' },
    { id: 'sky', name: 'Cobalt Peak', keys: [0x363b45, 0x2250c0, 0xcdd3de], riser: 0x171a20, wall: 0x30353e, land: 0x3e4450, led: 0x3a8aff, sound: 'clicky' },
    { id: 'peri', name: 'Indigo Loft', keys: [0x393845, 0x4a36c0, 0xd2d0de], riser: 0x18171f, wall: 0x33323e, land: 0x424050, led: 0x7a6aff, sound: 'thock' },
    { id: 'lav', name: 'Violet Heights', keys: [0x3d3845, 0x8022c0, 0xd8d0de], riser: 0x1a1720, wall: 0x37323e, land: 0x464050, led: 0xb45aff, sound: 'crystal' },
    { id: 'orchid', name: 'Magenta Crown', keys: [0x403640, 0xac1494, 0xdcd0da], riser: 0x1e171e, wall: 0x3a3038, land: 0x4a3f48, led: 0xff3ad8, sound: 'galaxy' },
];
export const STAGES_PER_ZONE = 10;
// the zone stage n is in (1-based stages)
export const zoneIndex = (n) => Math.floor((Math.max(1, n) - 1) / STAGES_PER_ZONE);
export const zoneOf = (n) => ZONES[zoneIndex(n) % ZONES.length];
// a Summit: the landing after every tenth stage (11, 21, 31...)
export const isSummit = (n) => n > 1 && (n - 1) % STAGES_PER_ZONE === 0;
// how high up the sky is: bands of stages, each its own sky (client/src/engine.js MOODS)
export const SKIES = [
    { from: 1, mood: 'dusk', name: 'Neon Dusk' },
    { from: 31, mood: 'bluehour', name: 'Blue Hour' },
    { from: 61, mood: 'moonlit', name: 'Moonlit Sky' },
    { from: 91, mood: 'synth', name: 'Synth Sunset' },
    { from: 121, mood: 'twilight', name: 'Deep Twilight' },
    { from: 161, mood: 'aurora', name: 'Aurora' },
    { from: 211, mood: 'space', name: 'Starfield' },
];
export function skyOf(n) { let s = SKIES[0]; for (const k of SKIES) if (n >= k.from) s = k; return s; }

// ----- what a stage pays -----
export const upLevel = (p, id) => (p.ups && p.ups[id]) || 0;
export const stackMult = (r) => 1 + 0.5 * (r || 0);
export const palMult = (p) => { let m = 1; for (const id of p.team || []) { const k = buddyById[id]; if (k) m += k.mult - 1; } return m; };
export const coinMult = (p, x2, rush) => stackMult(p.restacks) * palMult(p) * (x2 ? 2 : 1) * (rush ? CFG.rushMult : 1);
// a new landing reached (the first time this stack), and again (a stage you'd climbed before)
export const stageCoins = (n) => 8 + Math.round(n * 2.5);
export const AGAIN_K = 0.25;
// one of a stage's floating coins
export const pickupCoins = (n) => 2 + Math.floor(n / 6);
export const SUMMIT_GEMS = 3;
export const walkOf = (p) => CFG.walk * (1 + 0.06 * upLevel(p, 'speed'));
export const powerOf = (p) => CFG.power * (1 + 0.05 * upLevel(p, 'jump'));
export const reachOf = (p) => 4.5 + 3 * upLevel(p, 'magnet');
export const luckOf = (p) => 0.015 * upLevel(p, 'luck');
export const LUCK_MULT = 5;
export const teamSize = (p) => 3 + upLevel(p, 'slots');
export const hasItem = (p, id) => !!(p.items && p.items[id]);
// skipping a stage with Gems (or a rewarded ad)
export const skipGems = (n) => 3 + Math.floor(n / 10);

// ----- the Gear Shop: upgrades for Coins (they stay through a Restack) -----
export const UPGRADES = [
    { id: 'jump', name: 'Boing Boots', icon: '🦘', text: '+5% jump height', base: 90, grow: 1.85, max: 12, stat: (n) => '+' + n * 5 + '%' },
    { id: 'speed', name: 'Zoom Sneakers', icon: '👟', text: '+6% run speed', base: 80, grow: 1.8, max: 12, stat: (n) => '+' + n * 6 + '%' },
    { id: 'magnet', name: 'Coin Magnet', icon: '🧲', text: 'Grab coins from further away', base: 250, grow: 2.3, max: 5, stat: (n) => (4.5 + 3 * n).toFixed(1) + ' studs' },
    { id: 'luck', name: 'Lucky Coins', icon: '🍀', text: 'A coin may pay x5', base: 400, grow: 2.2, max: 8, stat: (n) => Math.round(n * 15) / 10 + '%' },
    { id: 'slots', name: 'Pal Slots', icon: '🐾', text: '+1 Pal on your team', base: 15000, grow: 6, max: 3, stat: (n) => 3 + n + ' pals' },
];
export const upgradeById = lookup(Object.fromEntries(UPGRADES.map((u) => [u.id, u])));
export const upgradeCost = (u, n) => Math.round(u.base * Math.pow(u.grow, n));

// ----- gear: bought once, kept for good. tool: it's a button on the hotbar -----
export const ITEMS = [
    { id: 'glove', name: 'Bonk Glove', icon: '🥊', text: 'Bonk players near you off their feet (not on landings)', coins: 0, tool: true, free: true },
    { id: 'double', name: 'Double Jump', icon: '⏫', text: 'Jump again in mid-air', coins: 1200 },
    { id: 'carpet', name: 'Cloud Carpet', icon: '🌈', text: 'Hold JUMP while falling to float down', coins: 5000, tool: true },
    { id: 'hop', name: 'Rocket Hop', icon: '🚀', text: 'Blast straight up, once every ' + CFG.hopGap + ' s', coins: 14000, tool: true },
    { id: 'rainbow', name: 'Rainbow Glove', icon: '🌟', text: 'A harder bonk that leaves a rainbow', gems: 120, tool: true },
];
export const itemById = lookup(Object.fromEntries(ITEMS.map((i) => [i.id, i])));
// trails behind you (others see them too)
export const TRAILS = [
    { id: '', name: 'No trail', color: 0xffffff, coins: 0 },
    { id: 'pink', name: 'Bubblegum', color: 0xff7ac4, coins: 600 },
    { id: 'mint', name: 'Mint', color: 0x4ae8a8, coins: 2500 },
    { id: 'sky', name: 'Sky', color: 0x5aa8ff, coins: 9000 },
    { id: 'gold', name: 'Gold', color: 0xffc81a, coins: 40000 },
    { id: 'rainbow', name: 'Rainbow', color: 0xff5ab0, gems: 90, rainbow: true },
];
export const trailById = lookup(Object.fromEntries(TRAILS.map((t) => [t.id, t])));

// ----- Restack: back to stage 1 with no Coins, x0.5 more Coins for good, Gems. Your gear and Pals stay -----
export const restackNeed = (r) => 25 + 15 * (r || 0);
export const restackGems = (r) => 8 + 4 * (r || 0);

// ----- Pals: little keycap critters out of Capsules (bought at the stands on the plaza). Each multiplies your Coins -----
// shape and feat say how one is built (client/src/buddies.js)
export const RARITIES = lookup({
    common: { name: 'Common', color: '#c8d0dc' }, rare: { name: 'Rare', color: '#3ab4ff' }, epic: { name: 'Epic', color: '#b45aff' }, legendary: { name: 'Legendary', color: '#ffc42a' },
});
const RAR = ['common', 'rare', 'epic', 'legendary'];
const pal = (id, name, shape, c1, c2, feat) => ({ id, name, shape, c1, c2, feat });
const CAPS = [
    { id: 'c1', name: 'Pastel Capsule', cost: 300, color: 0xff9ad6, mults: [1.08, 1.15, 1.25, 1.45], pals: [pal('clicky', 'Clicky', 'key', 0xffc4e2, 0xff7ab4, ''), pal('mochi', 'Mochi', 'ball', 0xffffff, 0xffb4d6, 'sprinkles'), pal('bun', 'Keybun', 'cube', 0xffe0ef, 0xff8ac2, 'phones'), pal('pip', 'Pip', 'egg', 0xffd2b4, 0xff9a6a, 'beak')] },
    { id: 'c2', name: 'Lemonade Capsule', cost: 3000, color: 0xffd23a, mults: [1.2, 1.35, 1.55, 1.9], pals: [pal('zest', 'Zest', 'ball', 0xfff066, 0xffc81a, 'flame'), pal('fizz', 'Fizz', 'cyl', 0xfff8cc, 0xffd23a, 'handle'), pal('sunny', 'Sunny', 'star', 0xffd23a, 0xffffff, ''), pal('spacey', 'Spacey', 'wide', 0xfff2a0, 0xe8c040, 'buttons')] },
    { id: 'c3', name: 'Minty Capsule', cost: 25000, color: 0x4ae8a8, mults: [1.4, 1.65, 1.95, 2.5], pals: [pal('sprig', 'Sprig', 'cone', 0x88e6b8, 0x4ac890, 'halo'), pal('jelly', 'Jelly', 'ghost', 0xb8f2d4, 0xffffff, ''), pal('cube2', 'Cubey', 'cube', 0x4ac890, 0xb8f2d4, 'cube'), pal('frog', 'Hopkey', 'dome', 0x6ad870, 0x2a8a3a, 'cable')] },
    { id: 'c4', name: 'Skyline Capsule', cost: 220000, color: 0x5aa8ff, mults: [1.7, 2, 2.4, 3.2], pals: [pal('cloud', 'Puff', 'ball', 0xffffff, 0xbcd8ff, 'wings'), pal('jet', 'Jetkey', 'tall', 0x90bcff, 0x3a5aff, 'antenna'), pal('kite', 'Kite', 'gem', 0x5aa8ff, 0xffffff, ''), pal('bolt', 'Bolt', 'key', 0x3a5aff, 0xfff066, 'crown')] },
    { id: 'c5', name: 'Twilight Capsule', cost: 2000000, color: 0xb45aff, mults: [2.1, 2.5, 3, 4.2], pals: [pal('moth', 'Lumi', 'egg', 0xd6b8ff, 0x8a5aff, 'wings'), pal('owl', 'Hoot', 'egg', 0x7a70e8, 0xffffff, 'beak'), pal('wisp', 'Wisp', 'ghost', 0xc8a2ff, 0xffffff, ''), pal('moon', 'Moonkey', 'coin', 0xfff2d4, 0xc8a2ff, 'star')] },
    { id: 'c6', name: 'Cosmic Capsule', cost: 25000000, color: 0x3affd8, mults: [2.6, 3.2, 4, 6], pals: [pal('ufo', 'Zoop', 'disc', 0xb8c0d0, 0x3affd8, 'dome'), pal('planet', 'Orbi', 'ball', 0x8a6aff, 0xffc88a, 'ring'), pal('comet', 'Comet', 'cone', 0x3affd8, 0xffffff, 'flame'), pal('nova', 'Nova', 'star', 0xffe24a, 0xff8af0, 'halo')] },
    { id: 'g1', name: 'Rainbow Capsule', gems: 60, color: 0xff5ab0, mults: [2, 2.6, 3.4, 5], pals: [pal('prism', 'Prism', 'gem', 0xff8af0, 0x8ae8ff, 'halo'), pal('rbow', 'Arc', 'coin', 0xff5ab0, 0xffe24a, 'ring'), pal('candy', 'Candykey', 'key', 0xff9ad6, 0x8ae8ff, 'sprinkles'), pal('uni', 'Unikey', 'egg', 0xffffff, 0xff8af0, 'crown')] },
];
export const ODDS = [60, 28, 10, 2];
export const BOXES = CAPS.map((b, i) => ({ id: b.id, name: b.name, cost: b.cost || 0, gems: b.gems || 0, color: b.color, tier: i, buds: b.pals.map((x) => x.id), odds: ODDS }));
export const BUDDIES = CAPS.flatMap((b, i) => b.pals.map((x, j) => ({ ...x, mult: b.mults[j], rarity: RAR[j], box: b.id, tier: i })));
export const buddyById = lookup(Object.fromEntries(BUDDIES.map((k) => [k.id, k])));
export const boxById = lookup(Object.fromEntries(BOXES.map((c) => [c.id, c])));
// every Pal of a Capsule found: Gems, once
export const INDEX_GEMS = [5, 8, 12, 18, 25, 35, 30];

// ----- titles over your head: your highest stage ever -----
export const TITLES = [[0, 'Ground Floor'], [5, 'Stair Hopper'], [11, 'Key Climber'], [26, 'Cloud Walker'], [51, 'Sky Stacker'], [101, 'Sunset Scaler'], [161, 'Star Climber'], [251, 'Orbit Hopper'], [401, 'Clackstack Legend'], [701, 'Infinite']];
export function titleOf(top) { let t = TITLES[0][1]; for (const [n, name] of TITLES) if (top >= n) t = name; return t; }

// ----- the Prize Wheel: one spin's prizes (weights); coins: that many first-time stage clears' worth at your best stage -----
export const SPIN = [
    { w: 24, stages: 2, text: 'Coins', color: '#3ab4ff' }, { w: 15, gems: 5, text: '5 Gems', color: '#b45aff' }, { w: 13, stages: 5, text: 'Big Coins', color: '#2ad8e8' },
    { w: 11, x2: 10, text: 'x2 Coins', color: '#46ec50' }, { w: 9, gems: 12, text: '12 Gems', color: '#7a4aff' }, { w: 14, stages: 3, text: 'Coins', color: '#ffd028' },
    { w: 8, stages: 12, text: 'Huge Coins', color: '#ff5a8a' }, { w: 6, gems: 25, text: '25 Gems', color: '#ff9a1a' },
];

// ----- daily tasks -----
export const TASKS = lookup({
    climb: { text: 'Reach new landings', icon: '🧗', n: 12, gems: 5, stages: 3 },
    coins: { text: 'Grab floating coins', icon: '🪙', n: 40, gems: 5, stages: 3 },
    summit: { text: 'Reach a Summit', icon: '🏆', n: 1, gems: 6, stages: 4 },
    bonk: { text: 'Bonk players', icon: '🥊', n: 5, gems: 4, stages: 2 },
    caps: { text: 'Open Capsules', icon: '🥚', n: 3, gems: 5, stages: 3 },
    spins: { text: 'Spin the Prize Wheel', icon: '🎡', n: 2, gems: 5, stages: 2 },
    bounce: { text: 'Bounce on ENTER keys', icon: '↩️', n: 5, gems: 4, stages: 2 },
    rush: { text: 'Grab coins in a Rainbow Rush', icon: '🌈', n: 10, gems: 6, stages: 3 },
});
const TASK_POOL = ['summit', 'bonk', 'caps', 'spins', 'bounce', 'rush'];
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const dayLeft = (ms) => 86400 - Math.floor(ms / 1000) % 86400;
export function tasksFor(day) {
    let h = 2166136261;
    for (let i = 0; i < day.length; i++) { h ^= day.charCodeAt(i); h = Math.imul(h, 16777619); }
    const r = rngFrom(h >>> 0), pool = TASK_POOL.slice(), out = ['climb', 'coins'];
    while (out.length < 3) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
}

// ----- quests: always a next goal (shown at the top of the screen) -----
export const QUESTS = [
    { kind: 'top', n: 3, text: 'Climb to stage 3', gems: 2 },
    { kind: 'pickups', n: 5, text: 'Grab 5 floating coins', gems: 2 },
    { kind: 'upgrades', n: 1, text: 'Buy an upgrade at the Gear Shop', gems: 3 },
    { kind: 'top', n: 6, text: 'Climb to stage 6', stages: 3 },
    { kind: 'caps', n: 1, text: 'Open a Pal Capsule', gems: 3 },
    { kind: 'top', n: 11, text: 'Reach the first Summit (stage 11)', gems: 5 },
    { kind: 'bounces', n: 3, text: 'Bounce on 3 ENTER keys', gems: 3 },
    { kind: 'double', n: 1, text: 'Get the Double Jump', gems: 4 },
    { kind: 'bonks', n: 3, text: 'Bonk 3 players', gems: 3 },
    { kind: 'top', n: 21, text: 'Reach stage 21', gems: 6 },
    { kind: 'upgrades', n: 8, text: 'Own 8 upgrades', stages: 6 },
    { kind: 'spinsUsed', n: 2, text: 'Spin the Prize Wheel twice', gems: 4 },
    { kind: 'carpet', n: 1, text: 'Get the Cloud Carpet', gems: 6 },
    { kind: 'top', n: 31, text: 'Climb above the clouds (stage 31)', gems: 8 },
    { kind: 'caps', n: 5, text: 'Open 5 Capsules', gems: 6 },
    { kind: 'restacks', n: 1, text: 'Restack once', gems: 12 },
    { kind: 'pickups', n: 300, text: 'Grab 300 floating coins', stages: 10 },
    { kind: 'top', n: 51, text: 'Reach stage 51', gems: 10 },
    { kind: 'hop', n: 1, text: 'Get Rocket Hop', gems: 8 },
    { kind: 'summits', n: 10, text: 'Reach 10 Summits', gems: 12 },
    { kind: 'restacks', n: 3, text: 'Restack 3 times', gems: 15 },
    { kind: 'top', n: 91, text: 'Climb into the Candy Sunset (stage 91)', gems: 15 },
    { kind: 'caps', n: 25, text: 'Open 25 Capsules', gems: 15 },
    { kind: 'top', n: 121, text: 'Reach Twilight (stage 121)', gems: 20 },
    { kind: 'summits', n: 30, text: 'Reach 30 Summits', gems: 25 },
    { kind: 'top', n: 161, text: 'See the Aurora (stage 161)', gems: 30 },
    { kind: 'restacks', n: 6, text: 'Restack 6 times', gems: 30 },
    { kind: 'top', n: 211, text: 'Climb into space (stage 211)', gems: 50 },
    { kind: 'summits', n: 75, text: 'Reach 75 Summits', gems: 60 },
    { kind: 'top', n: 301, text: 'Reach stage 301', gems: 80 },
];

// ----- rewards: the 7-day daily reward, playtime gifts, codes, the Gem shop -----
export const DAILY = [{ stages: 3 }, { spins: 1 }, { gems: 8 }, { stages: 8 }, { x2: 15 }, { gems: 15 }, { stages: 20, gems: 25 }];
export function dailyStatus(d, now) {
    const today = dayKey(now), yest = dayKey(now - 86400000);
    if (!d || !d.last) return { can: true, day: 0, streak: 0 };
    if (d.last === today) return { can: false, day: d.streak % 7, streak: d.streak };
    const streak = d.last === yest ? d.streak : 0;
    return { can: true, day: streak % 7, streak };
}
// FREE gifts for playing (minutes into this session)
export const GIFTS = [{ min: 2, stages: 2 }, { min: 5, gems: 5 }, { min: 9, spins: 1 }, { min: 14, stages: 6 }, { min: 20, gems: 10 }, { min: 30, x2: 15 }, { min: 45, stages: 20, gems: 15 }];
export const CODES = lookup({ CLACKSTACK: { gems: 10 }, RAINBOW: { stages: 4 }, KEYCAP: { spins: 1 }, BLOXITY: { gems: 5 }, LEGION: { gems: 5 }, SKYHIGH: { x2: 10 } });
// Gems for Coins (that many first-time stage clears' worth at your best stage)
export const PACKS = [{ id: 'p1', gems: 10, stages: 4 }, { id: 'p2', gems: 30, stages: 14 }, { id: 'p3', gems: 80, stages: 45 }];
// a reward's Coins for you now: first-time clears' worth at your best stage, times your Restack bonus
export function rewardFor(p, r) {
    const out = {};
    if (r.stages) out.coins = Math.round(r.stages * stageCoins(Math.max(5, p.top || 1)) * stackMult(p.restacks));
    if (r.coins) out.coins = (out.coins || 0) + Math.round(r.coins);
    for (const k of ['gems', 'spins', 'x2']) if (r[k]) out[k] = r[k];
    return out;
}
// HTML: a coin is drawn (class "cc"), Gems are 💎
export function rewardText(r, plain) {
    return [r.coins ? fmt(r.coins) + (plain ? ' Coins' : ' <i class="cc"></i>') : '', r.gems ? r.gems + ' 💎' : '', r.spins ? r.spins + (r.spins > 1 ? ' spins' : ' spin') : '', r.x2 ? 'x2 Coins ' + r.x2 + ' min' : ''].filter(Boolean).join(' + ');
}

// ----- the leaderboards on Boxity (the server reports them; declared on the client too) -----
export const LEADERBOARDS = [
    { id: 'stage', label: 'Highest stage', order: 'desc', mode: 'best', format: 'number', reset: 'weekly' },
    { id: 'wins', label: 'Summit wins', order: 'desc', mode: 'sum', format: 'number', reset: 'weekly' },
    { id: 'playtime', label: 'Playtime (min)', order: 'desc', mode: 'sum', format: 'number', reset: 'none' },
    { id: 'coins', label: 'Coins earned', order: 'desc', mode: 'sum', format: 'compact', reset: 'weekly' },
];

export const BOT_NAMES = [
    'StairSprinter', 'KeycapKai', 'ClackQueen', 'HopHopHop', 'xXSpaceBarXx', 'ShiftyStacker', 'TowerTom', 'EnterKeyEmi', 'BouncyBo', 'CloudNine99',
    'PastelPip', 'EscapeArtist', 'NumLockNat', 'SkyHighSam', 'RainbowRae', 'TabTheTop', 'AltitudeAli', 'LoftyLou', 'KeebClimber', 'ZoomZuri',
];

// ----- helpers -----
export function rngFrom(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export function fmt(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    const u = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx'];
    let i = 0, x = v;
    while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
    return (x >= 100 ? Math.floor(x) : Math.floor(x * 10) / 10) + u[i];
}
export const fmtComma = (v) => { const s = String(Math.floor(v || 0)); return s.length < 4 || /e/.test(s) ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
export function clock(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
