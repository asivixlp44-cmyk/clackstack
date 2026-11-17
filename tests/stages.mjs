// Every stage the generator makes must be climbable with the starting jump (no upgrades, no Double Jump): from landing n over keys to
// landing n + 1, each hop's rise within the jump, each gap within the jump's reach. Bounce keys count as the cliff's way up.
// node tests/stages.mjs [stages]
import { buildStage, stageSolids, landingTop, landingBox, coinAt, toWorld, RISE, ROWS, U, KW } from '../shared/world.js';
import { CFG, jumpH, jumpV } from '../shared/config.js';

const N = +(process.argv[2] || 400);
const H = jumpH(CFG.power), V = jumpV(CFG.power);
// how far you travel in the air on a hop that ends `rise` higher (walking speed)
function reach(rise) {
    if (rise > H - 0.3) return -1;
    const up = V / CFG.grav, down = Math.sqrt(2 * (H - rise) / CFG.grav);
    return CFG.walk * (up + down);
}
const fails = [];
const kinds = {};
let keysTotal = 0, coinsTotal = 0;
for (let n = 1; n <= N; n++) {
    const st = buildStage(n);
    keysTotal += st.keys.length;
    for (const g of st.segs) kinds[g.type] = (kinds[g.type] || 0) + 1;
    // the standable keys, by row (sliders count wherever they are; blinking keys count: they come back)
    const rows = Array.from({ length: ROWS }, () => []);
    for (const k of st.keys) rows[k.row].push(k);
    // walk the rows: from what's reachable so far, can we get onto something in a later row?
    let reach0 = [{ u: -12.5, v: 12.5, top: landingTop(n), w: 25, d: 25, landing: true }];
    let lastRow = -1;
    for (let r = 0; r < ROWS; r++) {
        if (!rows[r].length) continue;
        const ok = rows[r].filter((k) => reach0.some((a) => {
            if (a.kind === 'bounce') return true; // a bounce clears the cliff
            const rise = k.top - a.top;
            const gap = Math.hypot(Math.max(0, Math.abs(k.u - a.u) - (k.w + a.w) / 2), k.slide || a.slide ? 0 : Math.max(0, Math.abs(k.v - a.v) - (k.d + a.d) / 2));
            if (rise <= 1.25 && gap < 0.5) return true;
            const R = reach(rise);
            return R > 0 && gap <= R * 0.8;
        }));
        if (!ok.length) { fails.push({ n, r, why: 'row unreachable', types: st.segs.map((g) => g.type).join(',') }); break; }
        reach0 = reach0.concat(ok).filter((a) => a.landing || r - a.row <= 4);
        lastRow = r;
    }
    const end = { u: 132.5, v: 12.5, top: landingTop(n + 1), w: 25, d: 25 };
    if (!reach0.some((a) => { const rise = end.top - a.top, gap = Math.max(0, Math.abs(end.u - a.u) - (end.w + a.w) / 2); return (rise <= 1.25 && gap < 0.5) || (reach(rise) > 0 && gap <= reach(rise) * 0.8); })) fails.push({ n, r: lastRow, why: 'next landing unreachable' });
    for (const k of st.keys) if (!Number.isFinite(k.top) || !Number.isFinite(k.u) || !Number.isFinite(k.v)) fails.push({ n, why: 'NaN key' });
    for (let i = 0; i < st.coins.length; i++) { const c = coinAt(n, i); if (!c || !Number.isFinite(c.y)) fails.push({ n, why: 'bad coin' }); }
    coinsTotal += st.coins.length;
    if (st.coins.length < 3) fails.push({ n, why: 'only ' + st.coins.length + ' coins' });
    // the solids: a box for every key and the landing, all finite
    const sol = stageSolids(n);
    if (sol.length !== st.keys.length + 1) fails.push({ n, why: 'solids' });
    for (const s of sol) for (let a = 0; a < 3; a++) if (!(s.max[a] > s.min[a])) fails.push({ n, why: 'empty solid' });
    // landing n + 1 sits RISE above landing n, at the start of the next face
    const lb = landingBox(n + 1), w = toWorld(n, 132.5, 12.5);
    if (Math.abs((lb.min[0] + lb.max[0]) / 2 - w.x) > 0.01 || Math.abs((lb.min[2] + lb.max[2]) / 2 - w.z) > 0.01) fails.push({ n, why: 'landing frame mismatch' });
    if (landingTop(n + 1) - landingTop(n) !== RISE) fails.push({ n, why: 'rise' });
}
void U; void KW;
console.log(`stages 1..${N}: ${keysTotal} keys (${(keysTotal / N).toFixed(0)} a stage), ${coinsTotal} coins; jump ${H.toFixed(1)} studs`);
console.log('segment kinds:', JSON.stringify(kinds));
if (fails.length) { console.log('FAIL', fails.length); console.log(fails.slice(0, 20)); process.exit(1); }
console.log('PASS: every stage is climbable with the starting jump');
