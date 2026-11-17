// The Stack on screen (shared/world.js has where everything stands): a colossal dark keyboard-case pillar rising from a round plaza,
// up through a sea of clouds and on into space, with flights of giant keycaps winding up round its outside. The pillar is one box that
// follows the camera up, painted in its shader (a keycap grid, each zone's colour, a seam at every landing). The flights are built in
// chunks, a stage each, round where you are (built a couple a frame as you climb, dropped when they're far): its keycaps one instanced
// draw (they press under feet), the risers under them and its landing merged into one mesh, its moving keys (blinking, sliding, dropping)
// a small instanced draw of their own. The landings' numbers are one pooled draw of signs; the coins near you one instanced draw.
// The plaza (the Gear Shop, the Capsule stands, the Prize Wheel, the Restack gate, the boards, trees and giant keycaps lying about) is
// built once.
import { T, V3, scene, texFrom, fitFont, prompts, selfLit, CLOUD_TEX, textPlane, moodColor } from './engine.js';
import { Kit, glowVCMaterial, batchKits } from './geo.js';
import { KeySet, keysNow } from './keys.js';
import { Signs, big, GOLD, LIME, WHITE, RED, AQUA, PINK } from './signs.js';
import { CU } from './clock.js';
import { ZONES, zoneOf, zoneIndex, BOXES, fmt, fmtComma, isSummit, STAGES_PER_ZONE, clamp } from '../../shared/config.js';
import { CORE, RISE, KEY_H, HUB_R, SPAWN, HUB, landingTop, toWorld, sideOf, buildStage, blinkOn, blinkLeft, slideV, coinAt, stageAtY } from '../../shared/world.js';

const shade = (c, k) => new T.Color(c).multiplyScalar(k).getHex();
const mixC = (a, b, k) => new T.Color(a).lerp(new T.Color(b), k).getHex();
const RAINBOW = [0xff5a8a, 0xff9a3a, 0xffd23a, 0x6ae86a, 0x3ad8e8, 0x5a8aff, 0xb46aff];
export const CLOUD_Y = 840;
const m4 = new T.Matrix4(), qI = new T.Quaternion(), q1 = new T.Quaternion(), vP = new V3(), vS = new V3(), eu = new T.Euler(), tc = new T.Color();

function colorGeo(g, c) {
    const n = g.attributes.position.count, col = new Float32Array(n * 3), cc = new T.Color(c);
    for (let i = 0; i < n; i++) { col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    return g;
}
const cylAt = (k, x, y, z, r0, r1, h, c, seg, glow) => k.addGeo(colorGeo(new T.CylinderGeometry(r0, r1, h, seg || 20), c), new T.Matrix4().makeTranslation(x, y, z), glow);
// a place on the plaza turned to face somewhere: b(lx, y, lz, sx, sy, sz, c, o) puts a box at local (lx, lz) turned ry
function placer(k, cx, cz, ry) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const to = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    const b = (lx, y, lz, sx, sy, sz, col, o) => { const [x, z] = to(lx, lz); k.box(x, y, z, sx, sy, sz, col, { ...(o || {}), ry: ry + ((o && o.ry) || 0) }); };
    b.at = to;
    return b;
}

// ----- the pillar: one box following the camera up, painted by height: a keyboard's dark anodised case, its panels' grooves, an LED
// strip round it at every landing and up its four corners in the zone's colour -----
const ZU = { uZone: { value: ZONES.map((z) => new T.Color(z.wall)) }, uLed: { value: ZONES.map((z) => new T.Color(z.led)) } };
function pillarMaterial() {
    const m = new T.MeshLambertMaterial({ color: 0xffffff });
    m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, ZU, { uNow: CU.uNow });
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW; varying vec3 vPN;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz; vPN = normal;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uZone[${ZONES.length}]; uniform vec3 uLed[${ZONES.length}]; uniform float uNow; varying vec3 vPW; varying vec3 vPN;
vec3 pLed; float pGlow;`)
            .replace('#include <color_fragment>', `#include <color_fragment>
// the zone by height (10 stages a zone), blending over a landing's height at the seam between two
float zh = vPW.y / ${(STAGES_PER_ZONE * RISE).toFixed(1)};
float zf = floor(zh), zt = smoothstep(0.9, 1.0, zh - zf);
int za = int(mod(zf, ${ZONES.length}.0)), zb = int(mod(zf + 1.0, ${ZONES.length}.0));
vec3 zc = mix(uZone[za], uZone[zb], zt);
pLed = mix(uLed[za], uLed[zb], zt);
// further round the zones (a lap of all ten) a little deeper
zc *= 1.0 - 0.06 * min(3.0, floor(zf / ${ZONES.length}.0));
// the case's panels, 10 studs: a dark groove round each, a fine vertical brushing on the metal
float hx = abs(vPN.x) > 0.5 ? vPW.z : vPW.x;
vec2 tg = vec2(hx, vPW.y) / 10.0;
vec2 tq = abs(fract(tg) - 0.5);
float groove = smoothstep(0.455, 0.485, max(tq.x, tq.y));
float brush = sin(hx * 7.3 + sin(vPW.y * 0.11) * 2.0) * sin(hx * 2.9 + 1.7);
zc *= (1.0 - 0.45 * groove) * (1.0 + 0.035 * brush);
// the LED strips: a thin line round the case at every landing's height (a soft wave of light rolling up through them), one up each
// corner, set into the metal
float sm = abs(fract((vPW.y - 1.0) / ${RISE.toFixed(1)} + 0.5) - 0.5) * ${RISE.toFixed(1)};
float ring = 1.0 - smoothstep(0.06, 0.2, sm);
float corner = 1.0 - smoothstep(0.08, 0.24, abs(abs(hx) - 59.3));
float wave = 0.62 + 0.38 * sin(uNow * 2.2 - vPW.y * 0.045);
pGlow = max(ring * 0.8, corner * 0.5) * wave;
diffuseColor.rgb = mix(zc, pLed * 0.2, max(ring, corner));`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += pLed * pGlow;`);
    };
    m.customProgramCacheKey = () => 'cs-pillar2';
    return selfLit(m);
}

// ----- the plaza's floor: a round desk mat, dark keycap tiles pressed into it, the odd one lit -----
function plazaTexture(low) {
    const N = low ? 256 : 512, c = document.createElement('canvas');
    c.width = c.height = N;
    const x = c.getContext('2d'), S = N / 4;
    x.fillStyle = '#1c1b24'; x.fillRect(0, 0, N, N);
    // dark tiles and light ones, two to three
    const C = ['#363442', '#cfc9d8', '#2c2a36', '#d8d2e0', '#403d4c'], LIT = ['#ff2d55', '#1ae0ff', '#ffc21a', '#9aff1a', '#b45aff', '#ff6a1a'];
    let s = 3;
    const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const px = i * S, py = j * S;
        x.fillStyle = C[(i * 3 + j * 2) % C.length];
        x.beginPath(); x.roundRect(px + S * 0.06, py + S * 0.06, S * 0.88, S * 0.88, S * 0.14); x.fill();
        // the cap's dished top, a shade lighter
        x.fillStyle = 'rgba(255,255,255,0.035)';
        x.beginPath(); x.roundRect(px + S * 0.16, py + S * 0.14, S * 0.68, S * 0.62, S * 0.12); x.fill();
        // now and then a lit one: its edge glowing
        if ((i + j * 3) % 5 === 1) {
            x.strokeStyle = LIT[(i + j * 2) % LIT.length]; x.globalAlpha = 0.55; x.lineWidth = S * 0.03;
            x.beginPath(); x.roundRect(px + S * 0.08, py + S * 0.08, S * 0.84, S * 0.84, S * 0.13); x.stroke(); x.globalAlpha = 1;
        }
    }
    // the mat's weave: fine noise over all of it
    for (let k = 0; k < N * 6; k++) { x.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.12)'; x.fillRect(R() * N, R() * N, 1 + R() * 2, 1); }
    const t = texFrom(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

// ----- a leaderboard's face -----
function boardTexture(title, unit) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 600;
    return { c, t: texFrom(c), title, unit, key: '' };
}
const hm = (secs) => { const m = Math.floor(secs / 60); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; };
function drawBoard(B, rows) {
    const key = JSON.stringify(rows || []);
    if (key === B.key) return;
    B.key = key;
    const x = B.c.getContext('2d'), Wd = 768, H = 900;
    x.setTransform(B.c.width / Wd, 0, 0, B.c.height / H, 0, 0);
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1a1830'); g.addColorStop(1, '#0a0912');
    x.fillStyle = g; x.fillRect(0, 0, Wd, H);
    x.fillStyle = 'rgba(255,255,255,0.035)'; for (let i = 0; i < 9; i++) for (let j = 0; j < 11; j++) { x.beginPath(); x.roundRect(10 + i * 84, 10 + j * 84, 70, 70, 14); x.fill(); }
    // a neon rule under the title
    const ln = x.createLinearGradient(40, 0, Wd - 40, 0); ln.addColorStop(0, '#ff2d55'); ln.addColorStop(0.5, '#b45aff'); ln.addColorStop(1, '#1ae0ff');
    x.fillStyle = ln; x.fillRect(40, 116, Wd - 80, 5);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    fitFont(x, B.title, Wd - 40, 74, 400, '"Luckiest Guy", Fredoka, sans-serif', 0.2);
    x.lineWidth = 14; x.strokeStyle = '#1a0a3a'; x.strokeText(B.title, Wd / 2, 70); x.fillStyle = '#ffe24a'; x.fillText(B.title, Wd / 2, 70);
    const medal = ['#ffd23a', '#d8dce8', '#e09a5a'];
    (rows || []).slice(0, 9).forEach((r, i) => {
        const y = 170 + i * 80;
        if (i < 3) { x.fillStyle = medal[i]; x.beginPath(); x.arc(52, y, 24, 0, Math.PI * 2); x.fill(); x.fillStyle = '#1a1030'; x.font = '700 30px Fredoka, sans-serif'; x.textAlign = 'center'; x.fillText(String(i + 1), 52, y + 2); }
        x.textAlign = 'left'; x.lineWidth = 8; x.strokeStyle = '#1a0a3a';
        const name = (i < 3 ? '' : '#' + (i + 1) + ' ') + r.n;
        fitFont(x, name, Wd - 330, 44, 700, 'Fredoka, sans-serif', 0);
        x.strokeText(name, i < 3 ? 90 : 40, y); x.fillStyle = '#ffffff'; x.fillText(name, i < 3 ? 90 : 40, y);
        x.textAlign = 'right'; x.font = '700 44px Fredoka, sans-serif';
        const v = B.unit === 'time' ? hm(r.v) : 'Stage ' + fmtComma(r.v);
        x.strokeText(v, Wd - 40, y); x.fillStyle = '#7dff6b'; x.fillText(v, Wd - 40, y);
    });
    if (!rows || !rows.length) { x.textAlign = 'center'; x.font = '700 46px Fredoka, sans-serif'; x.fillStyle = '#e0d4ff'; x.fillText('Be the first!', Wd / 2, 200); }
    B.t.needsUpdate = true;
}

// a stage's key colours (later rounds of the zones a little deeper)
function zoneColors(n) {
    const Z = zoneOf(n), deep = Math.min(3, Math.floor(zoneIndex(n) / ZONES.length)), k = 1 - deep * 0.06;
    // the legends: the zone's LED; on an accent cap a paler one (red on crimson would vanish), on a light grey cap a deep one (printed,
    // still lit a little)
    return { Z, keys: Z.keys.map((c) => shade(c, k)), riser: shade(Z.riser, k), land: shade(Z.land, k), led: Z.led, ink: Z.led, inkPale: mixC(Z.led, 0xffffff, 0.55), inkDeep: mixC(Z.led, 0x000000, 0.45) };
}
// the plaza's own colours: dark bodies, neon trim
const DK = 0x3a3746, DK2 = 0x4a4658, DK3 = 0x5c586c, NEON = 0xff3ab0;

export function buildTower(opts) {
    opts = opts || {};
    const low = !!opts.low;
    const keyFar = low ? 230 : 340;
    const group = new T.Group(), signs = new Signs(4, 448, 152), kitMat = glowVCMaterial(CU.uNow);
    // ----- the pillar -----
    const PH = 2400;
    const pillar = new T.Mesh(new T.BoxGeometry(CORE * 2, PH, CORE * 2), pillarMaterial());
    pillar.castShadow = false; pillar.receiveShadow = true;
    pillar.frustumCulled = false;
    scene.add(pillar);
    // the name painted on its south face, between the first flight and the one a lap above it
    const logo = textPlane([big('CLACKSTACK', PINK, 150, '#4a0a3a'), { t: 'the endless keycap tower', c: '#ffffff', s: '#4a0a3a', px: 52 }], 104, 1024, new V3(0, 78, CORE + 0.15), new V3(0, 78, CORE + 10), group);
    logo.renderOrder = 1;
    // ----- the sea of clouds the Stack climbs through (follows the camera across) -----
    // (forceSinglePass: three.js draws a see-through two-sided material twice, flagging it changed around each pass, so its shader is
    // worked out again twice a frame; a flat sheet doesn't need the second pass)
    const cloudMat = new T.MeshBasicMaterial({ color: 0xffffff, alphaMap: CLOUD_TEX, transparent: true, opacity: 0.95, depthWrite: false, side: T.DoubleSide, forceSinglePass: true, toneMapped: false });
    const cloudGeo = new T.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2);
    const uv = cloudGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 9, uv.getY(i) * 9);
    const clouds = new T.Mesh(cloudGeo, cloudMat);
    clouds.position.y = CLOUD_Y; clouds.renderOrder = 5; clouds.frustumCulled = false;
    scene.add(clouds);
    const clouds2 = new T.Mesh(cloudGeo, cloudMat.clone());
    clouds2.material.opacity = 0.6;
    clouds2.position.y = CLOUD_Y - 28; clouds2.renderOrder = 5; clouds2.frustumCulled = false;
    scene.add(clouds2);
    // ----- the plaza -----
    const kHub = new Kit({ glow: true }), kTrees = new Kit({ glow: true });
    kTrees.far = 520;
    const floor = new T.Mesh(new T.CircleGeometry(HUB_R + 18, 72).rotateX(-Math.PI / 2), new T.MeshLambertMaterial({ map: plazaTexture(low) }));
    floor.material.map.repeat.set((HUB_R + 18) / 16, (HUB_R + 18) / 16);
    { const u2 = floor.geometry.attributes.uv; for (let i = 0; i < u2.count; i++) u2.setXY(i, u2.getX(i) * 1, u2.getY(i) * 1); }
    floor.position.y = 0.02; floor.receiveShadow = true; floor.renderOrder = -1;
    group.add(floor);
    // its rim: a ring of dark keycap blocks, an LED strip along their tops running through the rainbow
    for (let i = 0; i < 120; i++) {
        const a = i / 120 * Math.PI * 2, r = HUB_R + 18;
        kHub.box(Math.cos(a) * r, 0.9, Math.sin(a) * r, 13, 1.8, 4, DK2, { ry: -a + Math.PI / 2, soft: true });
        kHub.box(Math.cos(a) * (r - 1.4), 1.84, Math.sin(a) * (r - 1.4), 13.2, 0.12, 0.5, RAINBOW[Math.floor(i / 3) % RAINBOW.length], { ry: -a + Math.PI / 2, glow: 7.95 });
    }
    // a path ring round the pillar's foot, an LED line along each edge
    kHub.addGeo(colorGeo(new T.RingGeometry(CORE + 30, CORE + 44, 64).rotateX(-Math.PI / 2), 0x2e2c38), new T.Matrix4().makeTranslation(0, 0.06, 0));
    kHub.addGeo(colorGeo(new T.RingGeometry(CORE + 29.6, CORE + 30.2, 64).rotateX(-Math.PI / 2), 0xb45aff), new T.Matrix4().makeTranslation(0, 0.08, 0), 7.8);
    kHub.addGeo(colorGeo(new T.RingGeometry(CORE + 43.8, CORE + 44.4, 64).rotateX(-Math.PI / 2), 0x1ae0ff), new T.Matrix4().makeTranslation(0, 0.08, 0), 7.8);
    // the start pad: a round pad with a big arrow toward the first landing
    {
        cylAt(kHub, SPAWN.x, 0.2, SPAWN.z, 13, 13.6, 0.4, DK2, 32);
        cylAt(kHub, SPAWN.x, 0.42, SPAWN.z, 11, 11, 0.12, NEON, 32, 7.9);
        cylAt(kHub, SPAWN.x, 0.46, SPAWN.z, 10.2, 10.2, 0.12, 0x2e2c38, 32);
        for (let k = 0; k < 4; k++) { const z = SPAWN.z - 20 - k * 9; kHub.box(SPAWN.x - 3.2, 0.25, z, 8, 0.3, 2.4, 0x46ec50, { glow: 2, ry: 0.85 }); kHub.box(SPAWN.x + 3.2, 0.25, z, 8, 0.3, 2.4, 0x46ec50, { glow: 2, ry: -0.85 }); }
        signs.add([big('CLIMB!', LIME, 112, '#0a3a10'), { t: 'the first landing is straight ahead', c: '#ffffff', s: '#0a3a10', px: 36 }], 16, new V3(SPAWN.x, 13, SPAWN.z - 46), true, 140);
    }
    // the Gear Shop: a counter under a striped awning, boots and sneakers on show
    {
        const b = placer(kHub, HUB.shop.x, HUB.shop.z, Math.atan2(SPAWN.x - HUB.shop.x, SPAWN.z - HUB.shop.z));
        b(0, 0.2, 0, 28, 0.4, 16, DK, { soft: true });
        b(0, 6, -8, 26, 12, 3, 0x3a1236);
        b(0, 2.2, 1, 22, 4.4, 4, DK2, { soft: true });
        b(0, 4.6, 1, 23, 0.5, 5, DK3);
        b(0, 4.88, 3.45, 23, 0.14, 0.2, NEON, { glow: 7.95 });
        for (let i = 0; i < 9; i++) b(-11 + i * 2.75, 12.6, -2, 2.75, 0.6, 14, i % 2 ? 0x8e1a5a : DK2, { rx: -0.16 });
        b(0, 11.55, 5, 25, 0.16, 0.24, NEON, { glow: 7.95 });
        for (const lx of [-11.5, 11.5]) b(lx, 6.3, 4.5, 1.2, 12.6, 1.2, DK3, { soft: true });
        b(-7, 5.6, 1, 3, 1.6, 4, 0xff3a4a, { soft: true }); b(-2.5, 5.6, 1, 3, 1.6, 4, 0x3ab4ff, { soft: true }); b(2.5, 5.6, 1, 3.4, 2, 3.4, 0xffd23a, { soft: true }); b(7, 5.8, 1, 2.6, 2.4, 2.6, 0x8a5aff, { soft: true });
        signs.add([big('GEAR SHOP', PINK, 118, '#4a0a3a'), { t: 'boots, sneakers, carpets', c: '#ffffff', s: '#4a0a3a', px: 40 }], 20, new V3(HUB.shop.x, 19, HUB.shop.z), false, 220);
    }
    // the Capsule stands: a pedestal each, its capsule floating over it
    for (const c of HUB.caps) {
        const box = BOXES[c.i];
        cylAt(kHub, c.x, 1.5, c.z - 2, 3.6, 4.2, 3, DK2, 24);
        cylAt(kHub, c.x, 3.05, c.z - 2, 3.4, 3.4, 0.14, box.color, 24, 7.95);
        cylAt(kHub, c.x, 0.3, c.z - 2, 4.5, 4.5, 0.1, box.color, 24, 7.6);
        const ph = (c.i * 0.13) % 1;
        kHub.addGeo(colorGeo(new T.SphereGeometry(2.6, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), box.color), new T.Matrix4().makeTranslation(c.x, 7.4, c.z - 2), 5 + ph);
        kHub.addGeo(colorGeo(new T.SphereGeometry(2.6, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xc8c8d4), new T.Matrix4().makeTranslation(c.x, 7.2, c.z - 2), 5 + ph);
        kHub.addGeo(colorGeo(new T.TorusGeometry(2.62, 0.22, 6, 24).rotateX(Math.PI / 2), shade(box.color, 0.75)), new T.Matrix4().makeTranslation(c.x, 7.3, c.z - 2), 5 + ph);
        signs.add([big(box.name.replace(' Capsule', ''), WHITE, 64), big(box.gems ? box.gems + ' GEMS' : fmt(box.cost) + ' COINS', box.gems ? PINK : GOLD, 66, '#3a1a00')], 14, new V3(c.x, 14, c.z - 2), false, 120);
    }
    // the Prize Wheel: upright, its wedges in the rainbow
    let wheelMesh = null;
    {
        const w = HUB.wheel, b = placer(kHub, w.x, w.z, Math.atan2(SPAWN.x - w.x, SPAWN.z - w.z));
        b(0, 0.4, 0, 14, 0.8, 8, DK2, { soft: true });
        b(0, 0.86, 4.05, 14, 0.12, 0.2, 0xffc21a, { glow: 7.95 });
        for (const lx of [-2.6, 2.6]) b(lx, 6, -4, 1.4, 12, 1.4, DK3, { soft: true });
        const g = new T.Group();
        for (let i = 0; i < 8; i++) {
            const seg = new T.Mesh(new T.CylinderGeometry(7, 7, 1, 12, 1, false, i / 8 * Math.PI * 2, Math.PI * 2 / 8), new T.MeshLambertMaterial({ color: RAINBOW[i % 7] }));
            seg.rotation.x = Math.PI / 2;
            g.add(seg);
        }
        const hub = new T.Mesh(new T.CylinderGeometry(1.4, 1.4, 1.6, 16), new T.MeshLambertMaterial({ color: DK3 }));
        hub.rotation.x = Math.PI / 2; g.add(hub);
        const [wx, wz] = b.at(0, -3.2);
        g.position.set(wx, 12.5, wz);
        g.rotation.y = Math.atan2(SPAWN.x - w.x, SPAWN.z - w.z);
        for (const m of g.children) selfLit(m.material);
        scene.add(g);
        wheelMesh = g;
        b(0, 20.6, -3.2, 1.6, 2.6, 1.6, 0xff3a4a, { rx: 0.0 });
        signs.add([big('PRIZE WHEEL', GOLD, 112, '#3a1a00'), { t: 'a free spin every few minutes', c: '#ffffff', s: '#3a1a00', px: 38 }], 18, new V3(w.x, 26, w.z), false, 200);
    }
    // the Restack gate: an arch of keycaps, a rainbow swirl inside
    let swirl = null;
    {
        const r = HUB.restack, ry = Math.atan2(SPAWN.x - r.x, SPAWN.z - r.z), b = placer(kHub, r.x, r.z, ry);
        // dark keycaps stacked into an arch, each with a lit edge in the rainbow
        for (let i = 0; i < 6; i++) for (const lx of [-9, 9]) { b(lx, 1.6 + i * 3.2, 0, 4.4, 3, 4.4, DK2, { soft: true }); b(lx, 0.16 + i * 3.2, 0, 4.5, 0.18, 4.5, RAINBOW[(i + (lx > 0 ? 3 : 0)) % 7], { glow: 7.9 }); }
        for (let i = 0; i < 5; i++) { b(-9 + i * 4.5, 20.8, 0, 4.4, 3, 4.4, DK2, { soft: true }); b(-9 + i * 4.5, 19.36, 0, 4.5, 0.18, 4.5, RAINBOW[(i + 2) % 7], { glow: 7.9 }); }
        b(0, 0.2, 0, 24, 0.4, 10, DK, { soft: true });
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const x = c.getContext('2d'), gr = x.createConicGradient(0, 128, 128);
        RAINBOW.forEach((col, i) => gr.addColorStop(i / RAINBOW.length, '#' + col.toString(16).padStart(6, '0')));
        gr.addColorStop(1, '#ff5a8a');
        x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
        const rg = x.createRadialGradient(128, 128, 10, 128, 128, 128); rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = rg; x.fillRect(0, 0, 256, 256);
        const tex = texFrom(c); tex.center.set(0.5, 0.5);
        swirl = new T.Mesh(new T.PlaneGeometry(13.6, 17.6), new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, side: T.DoubleSide, forceSinglePass: true, toneMapped: false }));
        swirl.position.set(r.x, 10.4, r.z); swirl.rotation.y = ry;
        group.add(swirl);
        signs.add([big('RESTACK', PINK, 112, '#4a0a3a'), { t: 'back to stage 1, more Coins for good', c: '#ffffff', s: '#4a0a3a', px: 36 }], 18, new V3(r.x, 27, r.z), false, 200);
    }
    // the boards
    const BT = [boardTexture('HIGHEST CLIMBERS', 'stage'), boardTexture('MOST TIME PLAYED', 'time')];
    HUB.boards.forEach((bd, i) => {
        const ry = Math.atan2(SPAWN.x - bd.x, SPAWN.z - bd.z), b = placer(kHub, bd.x, bd.z, ry);
        b(0, 11, 0, 30, 22, 2, DK2, { soft: true });
        b(0, 11, 0.98, 27.4, 17.2, 0.1, [NEON, 0x1ae0ff][i], { glow: 7.9 });
        for (const lx of [-13, 13]) b(lx, 2, -1.5, 1.6, 4, 3, DK3, { soft: true });
        const pl = new T.Mesh(new T.PlaneGeometry(26, 15.8), new T.MeshBasicMaterial({ map: BT[i].t, toneMapped: false }));
        const [px, pz] = b.at(0, 1.08);
        pl.position.set(px, 11.3, pz); pl.rotation.y = ry;
        group.add(pl);
        drawBoard(BT[i], []);
    });
    // lollipop trees round the edge, giant keycaps lying about
    {
        let s = 99;
        const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        const clear = (x, z) => [HUB.shop, HUB.wheel, HUB.restack, ...HUB.boards.map((b) => ({ ...b, r: 22 })), ...HUB.caps.map((c) => ({ ...c, r: 10 }))].every((o) => Math.hypot(x - o.x, z - o.z) > (o.r || 14) + 14) && Math.hypot(x - SPAWN.x, z - SPAWN.z) > 30;
        // a neon garden: dark stems, jewel-toned crowns glowing softly from inside
        const CAN = [0xc81a5a, 0x0a8ab0, 0xc8900a, 0x4a9a10, 0x7a2ac8, 0xc84a10];
        for (let i = 0; i < 46; i++) {
            const a = R() * Math.PI * 2, r = 120 + R() * (HUB_R - 135), x = Math.cos(a) * r, z = Math.sin(a) * r;
            if (!clear(x, z)) continue;
            const h = 8 + R() * 6, rad = 4 + R() * 2.5, c = CAN[i % CAN.length];
            cylAt(kTrees, x, h / 2, z, 0.7, 0.9, h, DK3, 8);
            kTrees.addGeo(colorGeo(new T.IcosahedronGeometry(rad, 1), c), new T.Matrix4().makeTranslation(x, h + rad * 0.7, z), 0.38);
            kTrees.addGeo(colorGeo(new T.IcosahedronGeometry(rad * 0.55, 1), shade(c, 1.25)), new T.Matrix4().makeTranslation(x + rad * 0.5, h + rad * 1.2, z + rad * 0.3), 0.5);
            // the light it throws on the mat round its foot
            kTrees.addGeo(colorGeo(new T.CircleGeometry(rad * 0.9, 16).rotateX(-Math.PI / 2), shade(c, 0.5)), new T.Matrix4().makeTranslation(x, 0.07, z), 0.6);
        }
        // the trees past the plaza, out on the dark meadow: silhouettes
        const FAR = [0x1e3a3a, 0x2a2440, 0x1a3028, 0x302238];
        for (let i = 0; i < 70; i++) {
            const a = R() * Math.PI * 2, r = HUB_R + 50 + R() * 600, x = Math.cos(a) * r, z = Math.sin(a) * r;
            const h = 10 + R() * 10, rad = 5 + R() * 4, c = FAR[i % FAR.length];
            cylAt(kTrees, x, h / 2, z, 0.9, 1.1, h, 0x1a1820, 6);
            kTrees.addGeo(colorGeo(new T.IcosahedronGeometry(rad, 1), c), new T.Matrix4().makeTranslation(x, h + rad * 0.7, z));
        }
    }
    const decoKeys = [];
    {
        let s = 7;
        const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        for (let i = 0; i < 22; i++) {
            const a = R() * Math.PI * 2, r = 110 + R() * 170, x = Math.cos(a) * r, z = Math.sin(a) * r;
            if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 40 || HUB.caps.some((c) => Math.hypot(x - c.x, z - c.z) < 18) || [HUB.shop, HUB.wheel, HUB.restack].some((o) => Math.hypot(x - o.x, z - o.z) < 28) || HUB.boards.some((o) => Math.hypot(x - o.x, z - o.z) < 26)) continue;
            const Z = ZONES[i % ZONES.length], w = 7 + R() * 5;
            decoKeys.push({ x, y: 0, z, w, h: 4 + R() * 2, d: w, color: Z.keys[i % 3], ink: i % 3 === 1 ? mixC(Z.led, 0xffffff, 0.55) : i % 3 === 2 ? mixC(Z.led, 0x000000, 0.45) : Z.led, lit: Z.led, cell: Math.floor(R() * 26), ry: R() * Math.PI });
        }
    }
    const decoSet = new KeySet(decoKeys);
    decoKeys.forEach((k, i) => decoSet.mesh.setMatrixAt(i, m4.compose(vP.set(k.x, k.y, k.z), q1.setFromAxisAngle(new V3(0, 1, 0), k.ry), vS.set(k.w, k.h, k.d))));
    decoSet.mesh.instanceMatrix.needsUpdate = true; decoSet.mesh.castShadow = true;
    group.add(decoSet.mesh);
    // (its own material: a batched mesh and the chunks' plain meshes on one material would switch its program at every draw)
    const hubMesh = batchKits([kHub, kTrees], glowVCMaterial(CU.uNow), true);
    if (hubMesh) group.add(hubMesh);
    // ----- the beacon over the next landing you haven't reached -----
    const colG = new T.CylinderGeometry(3.4, 3.4, 1, 18, 1, true).translate(0, 0.5, 0);
    const beaconMat = new T.MeshBasicMaterial({ color: 0x7dff6b, transparent: true, opacity: 0.32, depthWrite: false, side: T.DoubleSide, forceSinglePass: true, toneMapped: false });
    const beacon = new T.Mesh(colG, beaconMat);
    beacon.visible = false; beacon.renderOrder = 4; beacon.frustumCulled = false;
    scene.add(beacon);
    // ----- the coins near you: one instanced draw -----
    // a minted coin: a raised rim with a milled edge, the face a step down inside it, a boss in the middle (turned on a lathe, its
    // faces towards ±z)
    // (bottom to top: its faces outward)
    const coinGeo = new T.LatheGeometry([[0, -0.13], [0.95, -0.12], [1.06, -0.18], [1.38, -0.21], [1.5, -0.13], [1.5, 0.13], [1.38, 0.21], [1.06, 0.18], [0.95, 0.12], [0, 0.13]].map(([r, y]) => new T.Vector2(r, y)), low ? 12 : 18).rotateX(Math.PI / 2);
    coinGeo.computeVertexNormals();
    const coinMat = selfLit(new T.MeshLambertMaterial({ color: 0xffc21a, emissive: 0xc87a00, emissiveIntensity: 0.55 }));
    const COINMAX = 48, coins = new T.InstancedMesh(coinGeo, coinMat, COINMAX);
    coins.count = 0; coins.frustumCulled = false; coins.castShadow = false;
    scene.add(coins);
    const coinList = [];
    // ----- the flights: chunks round where you are -----
    const chunks = new Map(), pool = [];
    for (let i = 0; i < 30; i++) pool.push(signs.add([big('0', WHITE, 120)], 9, new V3(0, -999, 0), false, 340));
    signs.build(group);
    for (const s of pool) signs.show(s, false);
    const kitGroup = new T.Group();
    scene.add(kitGroup);
    function buildChunk(n) {
        const st = buildStage(n), C = zoneColors(n), side = sideOf(n), swap = side % 2 === 1;
        const k = new Kit({ glow: true }), list = [], dyn = [], dynKeys = [];
        const L = landingTop(n), lc = toWorld(n, -12.5, 12.5), summit = isSummit(n);
        // the landing: a slab, a giant flat keycap on it (a star on a Summit's), an LED line round the slab's top edge
        k.box(lc.x, L - 3.7, lc.z, 25, 4.6, 25, C.riser, { soft: true });
        for (const [ox, oz, sx, sz] of [[0, 12.45, 25.1, 0.24], [0, -12.45, 25.1, 0.24], [12.45, 0, 0.24, 25.1], [-12.45, 0, 0.24, 25.1]]) k.box(lc.x + ox, L - 1.52, lc.z + oz, sx, 0.16, sz, summit ? 0xffc21a : C.led, { glow: 7.95 });
        list.push({ x: lc.x, y: L - 1.45, z: lc.z, w: 24.4, h: 1.45, d: 24.4, color: summit ? 0xb8860a : C.land, ink: summit ? 0xfff0a0 : C.led, cell: summit ? 43 : 44, lit: summit ? 0xffc21a : C.led });
        if (summit) {
            // a rainbow arch over a Summit's landing, across its diagonal
            const ry = -Math.atan2(toWorld(n, 0, 25).z - toWorld(n, -25, 0).z, toWorld(n, 0, 25).x - toWorld(n, -25, 0).x);
            RAINBOW.forEach((col, i) => k.addGeo(colorGeo(new T.TorusGeometry(16 - i * 0.9, 0.48, 6, 28, Math.PI), col), new T.Matrix4().compose(new V3(lc.x, L, lc.z), q1.setFromEuler(eu.set(0, ry, 0)), vS.set(1, 1, 1)), 1));
        }
        for (const key of st.keys) {
            const w = toWorld(n, key.u, key.v), ww = swap ? key.d : key.w, dd = swap ? key.w : key.d;
            let color = C.keys[key.c], ink = key.c === 1 ? C.inkPale : key.c === 2 ? C.inkDeep : C.ink, lit = C.led, led = C.led;
            if (key.kind === 'ice') { color = 0x1e3a50; ink = 0x9af0ff; lit = led = 0x5ae0ff; }
            else if (key.kind === 'bounce') { color = 0x147a2a; ink = 0xd8ffd0; lit = led = 0x46ff6a; }
            else if (key.kind === 'drop') { color = 0x3a2a24; ink = 0xff8a4a; lit = led = 0xff5a2a; }
            else if (key.kind === 'tall') { color = C.keys[1]; ink = C.inkPale; }
            if (key.blink) { color = 0x3a1a22; ink = 0xff6a7a; lit = led = 0xff2d40; }
            if (key.slide) { color = mixC(C.land, C.led, 0.18); ink = C.inkPale; }
            const moving = key.blink || key.slide || key.kind === 'drop';
            const capH = moving ? KEY_H + 1.2 : KEY_H;
            const e = { x: w.x, y: key.top - capH, z: w.z, w: ww, h: capH, d: dd, color, ink, cell: key.cell, lit };
            if (moving) { dynKeys.push({ key, i: dyn.length, e }); dyn.push(e); continue; }
            list.push(e);
            // under it: its pedestal down to the column's foot, and the switch's LED strip lighting the gap under the cap (the cap
            // comes down over both when pressed: they're narrower than its skirt)
            const bot = key.top - 5.5 - (key.kind === 'tall' ? 2 : 0), pt = key.top - KEY_H - 0.16;
            k.box(w.x, (bot + pt) / 2, w.z, ww * 0.9, pt - bot, dd * 0.9, key.c === 1 ? shade(C.riser, 1.2) : C.riser);
            k.box(w.x, pt + 0.05, w.z, ww * 0.86, 0.1, dd * 0.86, led, { glow: 7.9 });
        }
        const kmesh = batchKits([k], kitMat, true);
        kmesh.castShadow = true; kmesh.receiveShadow = true;
        kitGroup.add(kmesh);
        const keys = new KeySet(list);
        keys.mesh.castShadow = false;
        group.add(keys.mesh);
        let dset = null;
        if (dyn.length) { dset = new KeySet(dyn); dset.mesh.frustumCulled = false; dset.mesh.castShadow = true; group.add(dset.mesh); }
        // the number over the landing (a Summit's says so)
        const sign = pool.pop() || null;
        if (sign) {
            signs.set(sign, summit ? [big('SUMMIT', GOLD, 96, '#3a1a00'), big(String(n), WHITE, 120)] : [big(String(n), WHITE, 130, '#' + shade(C.riser, 0.45).toString(16).padStart(6, '0'))]);
            const corner = toWorld(n, -12.5, 20);
            signs.move(sign, new V3(corner.x, L + (summit ? 13 : 10), corner.z));
            signs.show(sign, true);
        }
        const cy = L + RISE / 2;
        return { n, kmesh, keys, dset, dynKeys, sign, cy, cx: toWorld(n, 60, 12.5).x, cz: toWorld(n, 60, 12.5).z, drops: new Map() };
    }
    function dropChunk(ch) {
        kitGroup.remove(ch.kmesh); ch.kmesh.geometry.dispose();
        ch.keys.dispose();
        if (ch.dset) ch.dset.dispose();
        if (ch.sign) { signs.show(ch.sign, false); pool.push(ch.sign); }
    }
    let center = 1;
    function wantRange(s) { return [Math.max(1, s - 8), s + 12]; }
    function ensure(s, budget) {
        const [a, b] = wantRange(s);
        for (const [n, ch] of chunks) if (n < a - 2 || n > b + 2) { dropChunk(ch); chunks.delete(n); }
        // nearest first
        let built = 0;
        for (let d = 0; d <= b - a && built < budget; d++) {
            for (const n of [s + d, s - d]) {
                if (n < a || n > b || chunks.has(n) || built >= budget) continue;
                chunks.set(n, buildChunk(n));
                built++;
            }
        }
        return built;
    }
    // nothing static here moves as a whole: its matrices are worked out once, not every frame
    group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    scene.add(group);
    // ----- prompts on the plaza -----
    const PR = [];
    PR.push({ pos: new V3(HUB.shop.x, 0, HUB.shop.z), r: HUB.shop.r + 6, label: () => 'Gear Shop', act: () => opts.shop && opts.shop(), zone: 'world', on: () => opts.onPlaza && opts.onPlaza() });
    PR.push({ pos: new V3(HUB.wheel.x, 0, HUB.wheel.z), r: HUB.wheel.r + 6, label: () => 'Prize Wheel', act: () => opts.wheel && opts.wheel(), zone: 'world', on: () => opts.onPlaza && opts.onPlaza() });
    PR.push({ pos: new V3(HUB.restack.x, 0, HUB.restack.z), r: HUB.restack.r + 5, label: () => 'Restack', act: () => opts.restack && opts.restack(), zone: 'world', on: () => opts.onPlaza && opts.onPlaza() });
    for (const bd of HUB.boards) PR.push({ pos: new V3(bd.x, 0, bd.z), r: 16, label: () => 'Leaderboards', act: () => opts.ranks && opts.ranks(), zone: 'world', on: () => opts.onPlaza && opts.onPlaza() });
    for (const c of HUB.caps) PR.push({ pos: new V3(c.x, 0, c.z), r: c.r + 4, label: () => BOXES[c.i].name, act: () => opts.box && opts.box(BOXES[c.i].id), zone: 'world', on: () => opts.onPlaza && opts.onPlaza() });
    prompts.length = 0; prompts.push(...PR);
    const DUMMY = new V3();
    const view = {
        group, chunks,
        setBoards(m) { drawBoard(BT[0], m.top); drawBoard(BT[1], m.time); },
        // build what's round stage s now (loading: all of it)
        prepare(s) { center = s; ensure(s, 99); },
        // the next landing you haven't reached: a column of light over it (0: none)
        setGoal(n) {
            if (!n) { beacon.visible = false; return; }
            const p = toWorld(n, -12.5, 12.5);
            beacon.position.set(p.x, landingTop(n), p.z);
            beacon.visible = true;
        },
        // a dropping key stepped on (key: its key object, t: keysNow())
        dropKey(n, key, t) { const ch = chunks.get(n); if (ch) ch.drops.set(key, t); },
        // a key pressed: it lights up
        lightKey(n, key) {
            const ch = chunks.get(n);
            if (!ch) return;
            const st = buildStage(n), i = st.keys.indexOf(key);
            if (i < 0) return;
            const d = ch.dynKeys.find((x) => x.key === key);
            if (d) { ch.dset.light(d.i); return; }
            // (the landing is index 0 of the static list: count the static keys before this one)
            let j = 1;
            for (let a = 0; a < i; a++) { const kk = st.keys[a]; if (!(kk.blink || kk.slide || kk.kind === 'drop')) j++; }
            ch.keys.light(j);
        },
        lightLanding(n) { const ch = chunks.get(n); if (ch) ch.keys.light(0); },
        // every frame: chunks round where you are, the moving keys, the coins, the clouds and the pillar following you up
        update(dt, t, cam, srvT, coinTaken) {
            const cp = cam.position;
            const s = stageAtY(Math.max(1, cp.y));
            if (s !== center || !this.full) { center = s; this.full = ensure(s, 2) === 0; }
            pillar.position.set(0, Math.max(PH / 2 - 20, Math.round(cp.y / RISE) * RISE), 0);
            pillar.updateMatrix(); pillar.matrixAutoUpdate = false; pillar.updateMatrixWorld(true);
            clouds.position.set(Math.round(cp.x / 100) * 100, CLOUD_Y, Math.round(cp.z / 100) * 100);
            clouds2.position.set(clouds.position.x, CLOUD_Y - 28, clouds.position.z);
            cloudGeo.attributes.uv.needsUpdate = false;
            cloudMat.alphaMap.offset.set(t * 0.002, t * 0.0011);
            const above = cp.y > CLOUD_Y;
            cloudMat.opacity = above ? 0.95 : 0.8; clouds2.material.opacity = above ? 0.55 : 0.45;
            // (lit by the sky: pink at dusk, moonlit blue at night)
            cloudMat.color.copy(moodColor('cloA')); clouds2.material.color.copy(moodColor('cloB')).lerp(cloudMat.color, 0.5);
            const kt = keysNow();
            for (const ch of chunks.values()) {
                const d = Math.hypot(cp.x - ch.cx, (cp.y - ch.cy) * 1.4, cp.z - ch.cz);
                const near = d < keyFar + 60;
                if (ch.keys.mesh.visible !== near) ch.keys.mesh.visible = near;
                // the flights well away from you: their keys' plain caps
                if (near) ch.keys.detail(d < 140);
                ch.keys.flushLit();
                if (!ch.dset) continue;
                ch.dset.mesh.visible = near;
                if (!near) continue;
                ch.dset.flushLit();
                const im = ch.dset.mesh;
                for (const dk of ch.dynKeys) {
                    const key = dk.key, e = dk.e;
                    let x = e.x, y = e.y, z = e.z, sc = 1, rx = 0;
                    if (key.slide) { const w = toWorld(ch.n, key.u, slideV(key.slide, srvT)); x = w.x; z = w.z; }
                    if (key.blink) {
                        if (!blinkOn(key.blink, srvT)) sc = 0;
                        else { const left = blinkLeft(key.blink, srvT); if (left < 0.75) { sc = 1; if (Math.floor(left * 8) % 2 === 0) ch.dset.light(dk.i); } }
                    }
                    if (key.kind === 'drop') {
                        const t0 = ch.drops.get(key);
                        if (t0 !== undefined) {
                            const a = kt - t0;
                            if (a < 0.45) { x += Math.sin(a * 70) * 0.18; z += Math.cos(a * 63) * 0.18; }
                            else if (a < 1.6) { const f = a - 0.45; y -= f * f * 40; rx = f * 1.6; }
                            else if (a < 3.4) sc = 0;
                            else { ch.drops.delete(key); ch.dset.born(dk.i); ch.dset.flush(); }
                        }
                    }
                    im.setMatrixAt(dk.i, sc ? m4.compose(vP.set(x, y, z), rx ? q1.setFromAxisAngle(new V3(1, 0, 0), rx) : qI, vS.set(e.w, e.h, e.d)) : m4.makeScale(0, 0, 0));
                }
                im.instanceMatrix.needsUpdate = true;
            }
            // the coins of the stages round you that you haven't taken (spinning, bobbing)
            coinList.length = 0;
            let ci = 0;
            for (let n = Math.max(1, s - 2); n <= s + 2 && ci < COINMAX; n++) {
                const st = buildStage(n);
                for (let i = 0; i < st.coins.length && ci < COINMAX; i++) {
                    if (coinTaken && coinTaken(n, i)) continue;
                    const c = coinAt(n, i);
                    coinList.push({ n, i, x: c.x, y: c.y, z: c.z });
                    coins.setMatrixAt(ci++, m4.compose(vP.set(c.x, c.y + Math.sin(t * 2.4 + i) * 0.35, c.z), q1.setFromAxisAngle(DUMMY.set(0, 1, 0), t * 2.6 + i), vS.set(1, 1, 1)));
                }
            }
            coins.count = ci;
            coins.instanceMatrix.needsUpdate = true;
            if (beacon.visible) { beacon.scale.set(1, 14 + Math.sin(t * 3) * 1.5, 1); beaconMat.opacity = 0.26 + Math.sin(t * 4) * 0.08; }
            if (swirl) { swirl.material.map.rotation = t * 0.8; }
            if (wheelMesh) wheelMesh.children.forEach((m) => { m.rotation.y = t * 0.25; });
            void dt;
        },
        coins: () => coinList,
        signs,
        dispose() { for (const ch of chunks.values()) dropChunk(ch); chunks.clear(); signs.dispose(); scene.remove(group, pillar, clouds, clouds2, beacon, coins, kitGroup); },
    };
    return view;
}
void clamp; void AQUA; void RED;
