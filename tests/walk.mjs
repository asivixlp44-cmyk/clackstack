// Walking up the stairs: on the shared physics, with JUMP never pressed, from each key of the way up to the next one a row higher (where
// there is one), for stages 1..N. Prints how many of those steps you simply walk up, by segment kind: the plain stairs should all be
// walkable; gaps (steps, leaps), blinking and sliding keys and cliffs still take a jump (no row after them to walk to).
// node tests/walk.mjs [N]
import { CFG } from '../shared/config.js';
import { newBody, stepBody } from '../shared/physics.js';
import { buildStage, stageSolids, toWorld, PILLAR } from '../shared/world.js';

const N = +(process.argv[2] || 300);
const by = {};
const fails = [];
for (let n = 1; n <= N; n++) {
    const st = buildStage(n), solids = [...stageSolids(n), ...stageSolids(n + 1), ...stageSolids(n - 1), PILLAR];
    const segOf = (row) => st.segs.find((g) => row >= g.r0 && row < g.r1);
    const path = new Map();
    for (const k of st.keys) if (k.path && !k.blink && !k.slide && k.kind !== 'bounce' && k.kind !== 'tall') path.set(k.row, k);
    for (const [row, a] of path) {
        const b = path.get(row + 1);
        if (!b) continue;
        const kind = segOf(row + 1).type;
        const e = by[kind] || (by[kind] = { walk: 0, of: 0 });
        e.of++;
        const wa = toWorld(n, a.u, a.v), wb = toWorld(n, b.u, b.v);
        const body = newBody(wa.x, a.top, wa.z);
        let ok = false;
        for (let s = 0; s < 120 && !ok; s++) {
            const dx = wb.x - body.x, dz = wb.z - body.z, d = Math.hypot(dx, dz) || 1;
            stepBody(body, { mx: dx / d, mz: dz / d, jump: false, hold: false, power: CFG.power, speed: 1 }, 1 / 60, { solids, floor: 0 });
            if (body.onGround && body.ground && body.ground.k === b) ok = true;
            if (body.y < a.top - 8) break;
        }
        if (ok) e.walk++;
        else if (fails.length < 8) fails.push(`stage ${n} row ${row} -> ${row + 1} (${kind}): rise ${(b.top - a.top).toFixed(2)}`);
    }
}
for (const [k, e] of Object.entries(by)) console.log(k.padEnd(7), `${e.walk} / ${e.of} walked up`, `(${(e.walk / e.of * 100).toFixed(1)}%)`);
if (fails.length) console.log('not walkable, e.g.:\n  ' + fails.join('\n  '));
