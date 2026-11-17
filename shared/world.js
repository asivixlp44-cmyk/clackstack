// The Stack: an endless square pillar, and the flights of giant keycaps winding up round its outside. Both sides build it from these
// numbers: the client draws it and moves you on it, the server checks where you say you are, which landing you reached and which coin you
// grabbed, and walks its bots up it.
//
// Every stage is one flight along one face of the pillar, from a corner landing to the next one RISE higher. Stage n's own frame: u along
// the flight (0..120 between its landings), v out from the wall (0..25). Its first landing is u -25..0 (the corner before the face).
// Faces go round: stage 1 along the south face heading east, stage 2 up the east face heading north, and so on, a lap every 4 stages.
// A stage is built from a seeded generator (the same keys on every screen and on the server), harder the higher it is: plain stairs,
// holes, stepping keys, long leaps, a single-key ridge, ENTER keys that bounce you up a cliff, slippery SHIFT keys, keys that blink in
// and out on the server's clock, keys sliding side to side, and keys that drop away under you.
import { CFG, jumpH, rngFrom, isSummit, clamp } from './config.js';

export const U = 5;            // a key's pitch (studs)
export const CORE = 60;        // the pillar's half width
export const BAND = 25;        // how far a flight reaches out from the wall
export const COLS = 5;         // keys across a flight
export const ROWS = 24;        // rows along a flight (its 120 studs)
export const RISE = 30;        // how much a stage climbs
export const KW = 4.6;         // a key's footprint (a little gap between keys)
export const KEY_H = 2.2;      // a keycap's own height (the riser under it makes up the rest)
export const COL_DEPTH = 5.5;  // a key's column: this far under its top
export const HUB_R = 300;      // the plaza round the foot of the Stack (you can't walk off it)
export const SPAWN = { x: -72.5, z: 150 };
export const SPAWN_YAW = 0;    // facing north, the Stack ahead and the first landing straight in front

// the top of landing n (n >= 1: landing n is where stage n starts)
export const landingTop = (n) => (n - 1) * RISE + 1;
export const sideOf = (n) => (((n - 1) % 4) + 4) % 4;
// stage n's frame -> the world
export function toWorld(n, u, v, out) {
    let x = u - CORE, z = CORE + v;
    const s = sideOf(n);
    for (let i = 0; i < s; i++) { const t = x; x = z; z = -t; }
    out = out || {};
    out.x = x; out.z = z;
    return out;
}
// the world -> stage n's frame
export function toLocal(n, x, z, out) {
    const s = sideOf(n);
    for (let i = 0; i < s; i++) { const t = z; z = x; x = -t; }
    out = out || {};
    out.u = x + CORE; out.v = z - CORE;
    return out;
}
// which way the flight heads (world), and the camera's yaw to look along it
export function forwardOf(n) { const a = toWorld(n, 0, 0), b = toWorld(n, 1, 0); return { x: b.x - a.x, z: b.z - a.z }; }
export function yawOf(n) { const f = forwardOf(n); return Math.atan2(-f.x, -f.z); }
// a box in stage n's frame -> a world AABB
const T0 = {}, T1 = {};
function boxOf(n, u0, u1, v0, v1, y0, y1, o) {
    toWorld(n, u0, v0, T0); toWorld(n, u1, v1, T1);
    return { min: [Math.min(T0.x, T1.x), y0, Math.min(T0.z, T1.z)], max: [Math.max(T0.x, T1.x), y1, Math.max(T0.z, T1.z)], ...(o || {}) };
}
// landing n (in stage n's frame u -25..0, v 0..25): its middle and its box
export function landingAt(n) { const c = toWorld(n, -12.5, 12.5); return { x: c.x, y: landingTop(n), z: c.z }; }
export function landingBox(n) { const y = landingTop(n); return boxOf(n, -25, 0, 0, 25, y - 6, y, { landing: n }); }
export function onLanding(n, x, y, z, slack) {
    const b = landingBox(n), s = slack || 0;
    return x >= b.min[0] - s && x <= b.max[0] + s && z >= b.min[2] - s && z <= b.max[2] + s && y >= b.max[1] - 1.2 - s && y <= b.max[1] + 4 + s;
}
// where you stand when you're sent to landing n (a spot on it, facing up the flight)
export function respawnAt(n, k) {
    const a = ((k || 0) * 2.399) % (Math.PI * 2), r = k ? 2 + ((k * 1.7) % 5) : 0;
    const c = toWorld(n, -12.5 + Math.cos(a) * r, 12.5 + Math.sin(a) * r);
    return { x: c.x, y: landingTop(n) + 0.05, z: c.z, ry: yawOf(n) + Math.PI };
}
// the stage whose height band y is in (its landing below you)
export const stageAtY = (y) => Math.max(1, Math.floor((y - 1) / RISE) + 1);
export const SUMMIT = isSummit;

// ----- what a stage is made of -----
// a key: { u, v (its middle, stage frame), w (along u), d (along v), top, kind ('key', 'bounce', 'ice', 'drop', 'tall'), cell (its legend),
//   c (which of the zone's colours), blink: { per, ph, on } (there while (t / per + ph) % 1 < on), slide: { v0, v1, per, ph } (it slides
//   along v between them), path (it's on the way up) }
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const cellOfChar = (ch) => { const i = LETTERS.indexOf(ch); return i < 26 ? i : 26 + (i - 26); };
const cache = new Map();
const CACHE_MAX = 80;
export function stageSeed(n) { return (Math.imul(n, 2654435761) ^ 0x5bd1e995) >>> 0; }
// the obstacle kinds a stage can use, by how high it is
function poolFor(n) {
    const p = ['stairs', 'stairs'];
    if (n >= 3) p.push('holes');
    if (n >= 5) p.push('steps');
    if (n >= 7) p.push('bounce');
    if (n >= 9) p.push('narrow');
    if (n >= 12) p.push('leaps');
    if (n >= 15) p.push('ice');
    if (n >= 18) p.push('blink');
    if (n >= 23) p.push('slide');
    if (n >= 27) p.push('drop');
    if (n >= 40) { p.splice(p.indexOf('stairs'), 1); p.push('leaps', 'blink'); }
    return p;
}
export function buildStage(n) {
    n = Math.max(1, Math.floor(n));
    const hit = cache.get(n);
    if (hit) return hit;
    const R = rngFrom(stageSeed(n));
    R(); R();
    const L = landingTop(n);
    // the segments: two on the first stages, three after
    const nseg = n < 8 ? 2 : 3, lens = nseg === 2 ? [12, 12] : [8, 8, 8], pool = poolFor(n), segs = [];
    let row = 0;
    for (let s = 0; s < nseg; s++) {
        let type = n <= 2 ? 'stairs' : pool[Math.floor(R() * pool.length)];
        // (one bounce a stage, and never in the last segment: its cliff needs the flight's rest to come back down to the landing)
        if (type === 'bounce' && (s === nseg - 1 || segs.some((g) => g.type === 'bounce'))) type = 'holes';
        // the first stage of a new kind gets an easy start
        if (s === 0 && n > 2 && R() < 0.4) type = 'stairs';
        segs.push({ type, r0: row, r1: row + lens[s] });
        row += lens[s];
    }
    // the height of each row: an even climb, a cliff after a bounce key
    const extra = new Float32Array(ROWS);
    let cliff = 0;
    for (const g of segs) if (g.type === 'bounce') { g.pad = g.r0 + 2; g.cliffAt = g.pad + 3; cliff = 9.5; for (let i = g.cliffAt; i < ROWS; i++) extra[i] = cliff; }
    const slope = (RISE - 1.25 - cliff) / ROWS;
    const nom = (i) => L + (i + 1) * slope + extra[i];
    const jit = Math.min(1.1, 0.25 + n * 0.025);
    // the way up: one column a row, wandering
    const lane = new Int8Array(ROWS);
    let ln = 2;
    for (let i = 0; i < ROWS; i++) {
        const g = segs.find((x) => i >= x.r0 && i < x.r1), rel = i - g.r0;
        const wander = g.type === 'narrow' ? 0.5 : g.type === 'leaps' ? 0.45 : 0.28;
        // (over a gap the way only shifts where there's a key: one column from the last one)
        const keyed = g.type === 'steps' ? rel % 2 === 0 : g.type === 'leaps' ? rel % 3 === 0 || i === g.r1 - 1 : true;
        if (i > 0 && keyed && R() < wander) ln = clamp(ln + (R() < 0.5 ? -1 : 1), 0, COLS - 1);
        lane[i] = ln;
    }
    const keys = [], coins = [];
    const key = (i, j, o) => {
        const top = o.top ?? nom(i), k = { u: i * U + U / 2, v: j * U + U / 2, w: KW, d: KW, top, kind: 'key', cell: Math.floor(R() * 26), c: Math.floor(R() * 3), path: j === lane[i], row: i, col: j, ...o };
        keys.push(k);
        return k;
    };
    const off = () => (R() - 0.5) * 2 * jit;
    for (const g of segs) {
        for (let i = g.r0; i < g.r1; i++) {
            const p = lane[i], rel = i - g.r0;
            switch (g.type) {
                case 'stairs':
                    for (let j = 0; j < COLS; j++) {
                        if (j === p) key(i, j, { top: nom(i) + off() * 0.35 });
                        // now and then a tall key off the way: go round it (or jump it). Not on the first flights: there you just walk up
                        // (the roll is made either way, so later stages come out the same)
                        else if (R() < 0.1 && Math.abs(j - p) > 1 && n > 3) key(i, j, { top: nom(i) + 2.4 + R() * 1.6, kind: 'tall' });
                        else key(i, j, { top: nom(i) + off() });
                    }
                    break;
                case 'holes':
                    for (let j = 0; j < COLS; j++) if (j === p || R() < (Math.abs(j - p) === 1 ? 0.5 : 0.3)) key(i, j, { top: nom(i) + off() * (j === p ? 0.35 : 1) });
                    break;
                case 'steps':
                    if (rel % 2 === 0) { key(i, p, { top: nom(i) + off() * 0.3 }); for (const j of [p - 1, p + 1]) if (j >= 0 && j < COLS && R() < 0.45) key(i, j, { top: nom(i) + off() * 0.5 }); }
                    break;
                case 'leaps':
                    if (rel % 3 === 0 || i === g.r1 - 1) { key(i, p, { top: nom(i) + off() * 0.25 }); if (R() < 0.3) { const j = p + (R() < 0.5 ? -1 : 1); if (j >= 0 && j < COLS) key(i, j, { top: nom(i) }); } }
                    break;
                case 'narrow':
                    // (the way's keys a row apart stay within a walk-up step of each other: physics.js STEP)
                    key(i, p, { top: nom(i) + off() * 0.35 });
                    break;
                case 'ice':
                    for (let j = 0; j < COLS; j++) if (Math.abs(j - p) <= 1 || R() < 0.3) key(i, j, { top: nom(i) + off() * 0.3, kind: 'ice', cell: 40 });
                    break;
                case 'blink': {
                    const ph = rel % 2 ? 0.5 : 0;
                    key(i, p, { top: nom(i) + off() * 0.3, blink: { per: 3.2, ph, on: 0.76 } });
                    const j = p + (R() < 0.5 ? -1 : 1);
                    if (j >= 0 && j < COLS && R() < 0.5) key(i, j, { top: nom(i), blink: { per: 3.2, ph, on: 0.76 } });
                    break;
                }
                case 'slide': {
                    // full rows with rows of one sliding key between them
                    const mode = rel % 3;
                    if (mode === 0 || i === g.r1 - 1) for (let j = 0; j < COLS; j++) key(i, j, { top: nom(i) + off() * 0.3 });
                    else key(i, 2, { w: KW, d: KW * 1.9, top: nom(i), kind: 'key', slide: { v0: 5, v1: 20, per: 3.6 + R() * 1.4, ph: R() } });
                    break;
                }
                case 'drop':
                    for (let j = 0; j < COLS; j++) if (Math.abs(j - p) <= 1 && (j === p || R() < 0.6)) key(i, j, { top: nom(i) + off() * 0.3, kind: 'drop', cell: 23 });
                    break;
                case 'bounce':
                    if (i < g.pad) for (let j = 0; j < COLS; j++) key(i, j, { top: nom(i) + off() * 0.4 });
                    else if (i === g.pad) key(i, 2, { w: KW, d: KW * 2.95, top: nom(i), kind: 'bounce', cell: 42 });
                    else if (i >= g.cliffAt) for (let j = 0; j < COLS; j++) key(i, j, { top: nom(i) + off() * 0.4 });
                    break;
            }
        }
    }
    // the path's key in each row (the coins float over it; the bots walk it)
    const pathKey = new Array(ROWS).fill(null);
    for (const k of keys) if ((k.path || k.kind === 'bounce' || k.slide) && !pathKey[k.row]) pathKey[k.row] = k;
    for (const r of [3, 9, 15, 21]) {
        let k = null;
        for (let d = 0; d < 4 && !k; d++) k = pathKey[r + d] || pathKey[r - d];
        if (k) coins.push({ u: k.slide ? k.u : k.u, v: k.slide ? 12.5 : k.v, y: k.top + 3.4 });
    }
    // each key's legend: letters, a word now and then
    keys.forEach((k, i) => { if (k.kind === 'key' || k.kind === 'tall') k.cell = cellOfChar(LETTERS[(k.cell + i) % 26]); });
    const st = { n, L, side: sideOf(n), keys, coins, segs, lane, pathKey, summit: isSummit(n + 1) };
    cache.set(n, st);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return st;
}
// a coin of stage n in the world
export function coinAt(n, i) { const st = buildStage(n), c = st.coins[i]; if (!c) return null; const w = toWorld(n, c.u, c.v); return { x: w.x, y: c.y, z: w.z }; }

// ----- moving things, on the server's clock (seconds) -----
export const blinkOn = (b, t) => ((t / b.per + b.ph) % 1 + 1) % 1 < b.on;
// how soon a blinking key goes (seconds; 0: it's gone)
export function blinkLeft(b, t) { const f = ((t / b.per + b.ph) % 1 + 1) % 1; return f < b.on ? (b.on - f) * b.per : 0; }
export function slideV(s, t) { const f = 0.5 - 0.5 * Math.cos(((t / s.per) + s.ph) * Math.PI * 2); return s.v0 + (s.v1 - s.v0) * f; }

// ----- the solids a body stands on and bumps into -----
// The pillar: from under the plaza to the top of the sky
export const PILLAR = { min: [-CORE, -20, -CORE], max: [CORE, 1e6, CORE], noStep: true, wall: true };
// The plaza's own solids (the client draws them): the Gear Shop, the Capsule stands, the Prize Wheel, the Restack gate, the boards
export const HUB = {
    shop: { x: -150, z: 118, r: 14 },
    wheel: { x: -168, z: 40, r: 11 },
    restack: { x: -190, z: -40, r: 13 },
    boards: [{ x: -132, z: 200, id: 'stage' }, { x: -86, z: 214, id: 'time' }],
    caps: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ x: -10 + i * 29, z: 172 + Math.abs(i - 3) * 3, r: 8, i })),
};
const hb = (x, y, z, sx, sy, sz, o) => ({ min: [x - sx / 2, y, z - sz / 2], max: [x + sx / 2, y + sy, z + sz / 2], noStep: true, ...(o || {}) });
export function hubSolids() {
    const out = [PILLAR];
    out.push(hb(HUB.shop.x, 0, HUB.shop.z - 8, 26, 12, 6));
    out.push(hb(HUB.wheel.x, 0, HUB.wheel.z - 4, 6, 18, 3));
    out.push(hb(HUB.restack.x - 9, 0, HUB.restack.z, 3, 20, 3), hb(HUB.restack.x + 9, 0, HUB.restack.z, 3, 20, 3));
    for (const b of HUB.boards) out.push(hb(b.x, 0, b.z, 30, 22, 2));
    for (const c of HUB.caps) out.push(hb(c.x, 0, c.z - 2, 7, 3, 7));
    return out;
}
// the plaza's edge: you can't walk off it
export function clampHub(b) {
    const r = Math.hypot(b.x, b.z);
    if (r > HUB_R && b.y < 4) { const k = HUB_R / r; b.x *= k; b.z *= k; }
}
// stage n's solids (static ones), in the world. A key's solid keeps a link to its key (k) for what it does (bounce, ice, drop)
const solidCache = new Map();
export function stageSolids(n) {
    if (n < 1) return [];
    let s = solidCache.get(n);
    if (s) return s;
    const st = buildStage(n), out = [landingBox(n)];
    for (const k of st.keys) {
        const top = k.top, bot = top - COL_DEPTH - (k.kind === 'tall' ? 2 : 0);
        const o = boxOf(n, k.u - k.w / 2, k.u + k.w / 2, k.v - k.d / 2, k.v + k.d / 2, bot, top, { k, n });
        if (k.kind === 'bounce' || k.kind === 'tall') o.noStep = k.kind === 'tall';
        out.push(o);
    }
    s = out;
    solidCache.set(n, s);
    if (solidCache.size > CACHE_MAX) solidCache.delete(solidCache.keys().next().value);
    return s;
}
// a moving key's box now (t: the server's clock, seconds), written into o; null when a blinking key is gone
export function liveBox(sol, t, o) {
    const k = sol.k;
    if (!k || (!k.blink && !k.slide)) return sol;
    if (k.blink && !blinkOn(k.blink, t)) return null;
    if (!k.slide) return sol;
    const v = slideV(k.slide, t);
    const b = boxOf(sol.n, k.u - k.w / 2, k.u + k.w / 2, v - k.d / 2, v + k.d / 2, sol.min[1], sol.max[1]);
    o.min = b.min; o.max = b.max; o.k = k; o.n = sol.n; o.noStep = sol.noStep;
    return o;
}
// the stages worth testing against at height y (the one you're in, and its neighbours)
export function stagesNear(y) { const s = stageAtY(y); return [s - 1, s, s + 1].filter((v) => v >= 1); }

// ----- the bots' way up: from landing n over the path's keys to landing n + 1 -----
export function routeOf(n) {
    const st = buildStage(n), pts = [];
    const a = landingAt(n);
    pts.push({ x: a.x, y: a.y, z: a.z });
    for (let i = 0; i < ROWS; i++) {
        const k = st.pathKey[i];
        if (!k) continue;
        const w = toWorld(n, k.u, k.slide ? 12.5 : k.v);
        pts.push({ x: w.x, y: k.top, z: w.z, bounce: k.kind === 'bounce' });
    }
    const b = landingAt(n + 1);
    pts.push({ x: b.x, y: b.y, z: b.z, land: n + 1 });
    return pts;
}
// the highest anyone can be: the landing after your best, a flight's worth, the best jump with every upgrade, Rocket Hop
export function maxYFor(best) { return landingTop(best + 2) + jumpH(CFG.power * 1.65) + 60; }
