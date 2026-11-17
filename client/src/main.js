import { Client } from '@colyseus/sdk';
import {
    T, V3, $, canvas, scene, camera, sun, renderer, updateSky, SUN_DIRECTION, GPU_NAME, setMood, setFogScale, updateEffects, floatText, prompts, billboard,
} from './engine.js';
import { S, actions, net, prof } from './state.js';
import { CU, setEpoch, rel } from './clock.js';
import { initAudio, resumeAudio, audioDebug, startMusic, sfx, setVolume, audioSuspended, setMusicMode, playAsmr, prerenderMusic, allowLiveMusic, audioAway, musicLite } from './audio.js';
import { buildAsmr } from './asmr.js';
import * as BX from './bloxity.js';
import { createAvatar, loadBase, packAvatar, characterIdOf } from './avatar.js';
import { pad, pollGamepad } from './gamepad.js';
import * as FX from './fx.js';
import { render, updateFx, setQuality, getQuality, autoQualityAllowed, shadowDue, setResScale, getResScale, fxWarmGroup, fxShowAll, updateAmbient, setSpeedLines, confetti, screenConfetti } from './fx.js';
import { buildTower } from './world.js';
import { installIcons } from './icons.js';
import * as SH from './shadows.js';
import { PRESS, PRESS_N, FRENZY, tickKeys, impact, keyWarmGroup, keyDetail, keysNow, PRESSED_TRAVEL } from './keys.js';
import { beginBuddies, endBuddies, placeTeam, buddiesWarm, buddyIcon } from './buddies.js';
import { Char, pumpAvatars, avatarsPending } from './chars.js';
import { Track, pingSend, onPong, pingEvery } from './smooth.js';
import {
    toast, bigText, popup, notEnough, animateCounters, bump, updateHud, openPanel, panelIs, refreshPanels, closeTop, anyPopup, codeResult, warmPanels,
    measureHud, onSpun, askConfirm, flyCoins, showHatch, setTutorial, setRush, summitCard, setGauge,
} from './ui.js';
import {
    CFG, QUESTS, TASKS, dailyStatus, fmt, fmtComma, clamp, titleOf, walkOf, powerOf, reachOf, hasItem, skipGems, zoneOf, skyOf, isSummit, itemById, trailById,
    buddyById, LEADERBOARDS, stageCoins, coinMult, pickupCoins,
} from '../../shared/config.js';
import { newBody, stepBody } from '../../shared/physics.js';
import {
    SPAWN, HUB, landingTop, landingAt, respawnAt, stageAtY, stagesNear, stageSolids, hubSolids, clampHub, liveBox, PILLAR, buildStage, coinAt, yawOf, toWorld, slideV, RISE, blinkLeft,
} from '../../shared/world.js';

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = () => new Promise((r) => setTimeout(r, 0));
const RND = Math.random;
const lerpA = (a, b2, k) => { let d = (b2 - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * k; };
const x2On = () => (S.x2Until || 0) > net.now();
const rushOn = () => !!(net.room && net.room.state && net.room.state.rush > net.now());
// the server's clock in seconds (the moving keys blink and slide on it, the same for everyone)
const srvT = () => (net.now() % 1e9) / 1000;

// =====================================================================================
// The tower on screen
// =====================================================================================
let view = null;
const towerOpts = {
    shop: () => openPanel('shop'),
    box: (id) => openPanel('box', id),
    wheel: () => openPanel('spin'),
    restack: () => openPanel('restack'),
    ranks: () => openPanel('ranks'),
    onPlaza: () => P.b.y < 8,
};
function buildView() {
    keyDetail(getQuality() === 'low');
    towerOpts.low = getQuality() === 'low';
    view = buildTower(towerOpts);
    view.prepare(1);
    view.setBoards(boards);
    setMood('dusk', true);
    setFogScale(1);
    return view;
}

// =====================================================================================
// You: the shared physics (shared/physics.js) on your screen, every frame, against the keys round you
// =====================================================================================
const HUB_SOLIDS = hubSolids();
const P = {
    b: newBody(SPAWN.x, 0, SPAWN.z), facing: Math.PI, moving: false,
    world: { solids: [], floor: 0, clamp: clampHub },
    jumpPress: -9, lastJump: -9, minVy: 0, stride: 0, lastStride: 0, auto: null, peakY: 0,
    frozen: false, snaps: 0, groundY: 0, bumpAt: -9, cpSent: new Map(), stunT: 0, hopAt: -99, slapAt: -99, slapT: -9, fallSent: -9,
    lastGround: null, coinAt: new Map(), drops: new Map(), onKey: false, glideSnd: 0, sink: 0, stepOff: 0,
};
// moving keys: their box now, from a pool (one per moving key near you)
const livePool = [];
let liveN = 0;
function gatherSolids() {
    const b = P.b, list = P.world.solids, t = srvT();
    list.length = 0; liveN = 0;
    if (b.y < 40) { for (const s of HUB_SOLIDS) list.push(s); } else list.push(PILLAR);
    const kt = keysNow();
    for (const n of stagesNear(b.y)) {
        for (const s of stageSolids(n)) {
            const k = s.k;
            let box = s;
            if (k && (k.blink || k.slide)) {
                const o = livePool[liveN] || (livePool[liveN] = { min: [0, 0, 0], max: [0, 0, 0] });
                box = liveBox(s, t, o);
                if (!box) continue;
                if (box === o) liveN++;
            } else if (k && k.kind === 'drop') {
                const t0 = P.drops.get(k);
                if (t0 !== undefined) { if (kt - t0 > 3.4) P.drops.delete(k); else if (kt - t0 > 0.45) continue; }
            }
            // (only what's near you: a move never reaches past this in a frame)
            if (box.max[0] < b.x - 16 || box.min[0] > b.x + 16 || box.max[2] < b.z - 16 || box.min[2] > b.z + 16 || box.max[1] < b.y - 16 || box.min[1] > b.y + 16) continue;
            list.push(box);
        }
    }
}
let me = null, localAvatarReq = 0;
function buildMe() {
    if (me) me.dispose();
    me = new Char({ name: S.name, lv: tagLine(S.top, S.wins), tr: titleOf(S.top) });
    me.buddyPos = [];
    setupLocalAvatar();
}
const tagLine = (top, wins) => 'Stage ' + fmtComma(top || 1) + ' · ' + fmtComma(wins || 0) + (wins === 1 ? ' Win' : ' Wins');
async function setupLocalAvatar() {
    const req = ++localAvatarReq;
    const a = await createAvatar(BX.currentAvatar(), BX.getSkinTextureUrl());
    if (!a) return;
    if (req !== localAvatarReq || !me) { a.dispose(); return; }
    me.wear(a);
}
function syncMyAvatar() {
    const av = BX.currentAvatar();
    // a switch to or from their own uploaded character: the rig is built again
    if (me && me.blox && av && me.blox.charId !== characterIdOf(av)) setupLocalAvatar();
    else if (me && me.blox && av) { me.blox.setProportions(av.proportions); me.blox.setEquipped(av, BX.getSkinTextureUrl()); }
    net.send('avatar', { av: packAvatar(av) });
}
function teleport(x, y, z, yaw) {
    const b = P.b;
    b.x = x; b.y = y; b.z = z; b.vx = b.vy = b.vz = 0; b.onGround = true; b.pound = false;
    P.peakY = y; P.stunT = 0;
    camSnap = true;
    if (yaw !== undefined) { P.facing = yaw; cam.yaw = yaw + Math.PI; }
    if (view) view.prepare(stageAtY(Math.max(1, y)));
    sendMove(true);
}
actions.respawn = () => net.send('respawn', {});
actions.goto = (n) => { n = clamp(n | 0, 1, S.best || 1); net.send('goto', { n }); };
actions.skip = () => {
    if ((S.cp || 1) !== (S.best || 1)) { actions.goto(S.best); toast('⏭️ Back to your best stage first: then SKIP', '#ffe24a'); return; }
    const g = skipGems(S.best || 1);
    askConfirm('⏭️', 'Skip stage ' + (S.best || 1) + '?', 'Straight to landing ' + ((S.best || 1) + 1) + '.', '💎 ' + g, () => net.send('skip', {}));
};
// a FREE skip: a rewarded ad, granted by the server only once Boxity says it was watched
let adAsking = false;
actions.adsOk = () => BX.adsAvailable();
actions.adSkip = async () => {
    if (adAsking) return;
    if ((S.cp || 1) !== (S.best || 1)) { actions.goto(S.best); toast('⏭️ Back to your best stage first: then SKIP', '#ffe24a'); return; }
    if (!BX.adsAvailable()) { toast('No ad right now. Try again later!', '#ff9a8a'); return; }
    adAsking = true;
    const r = await BX.showRewarded('skip-stage');
    adAsking = false;
    if (r && r.status === 'completed' && r.rewardToken) net.send('adskip', { token: r.rewardToken });
    else toast('No ad was watched: try again later!', '#ff9a8a');
};
actions.adX2 = async () => {
    if (adAsking) return;
    if (!BX.adsAvailable()) { toast('No ad right now. Try again later!', '#ff9a8a'); return; }
    adAsking = true;
    const r = await BX.showRewarded('double-coins');
    adAsking = false;
    if (r && r.status === 'completed' && r.rewardToken) net.send('adx2', { token: r.rewardToken });
    else toast('No ad was watched: try again later!', '#ff9a8a');
};

// ----- the tools: the Bonk Glove (and the Rainbow Glove), the Cloud Carpet, Rocket Hop -----
S.carpetOn = storageGet('cs1_carpet') !== '0';
actions.tool = (id) => {
    const t = clockT;
    if (!running || P.frozen) return;
    if (id === 'glove' || id === 'rainbow') {
        if (id === 'rainbow' && !hasItem(S, 'rainbow')) { openPanel('shop', 'gear'); return; }
        if (t - P.slapAt < CFG.slapGap) return;
        P.slapAt = t; P.slapT = t;
        playAsmr('boost', 0.3, 0.7);
        // the nearest player in front of you, within reach
        const b = P.b, fx = Math.sin(P.facing), fz = Math.cos(P.facing);
        let best = null, bd = 1e9;
        for (const [rid, r] of remotes) {
            if (r.x === undefined) continue;
            const dx = r.x - b.x, dz = r.z - b.z, d = Math.hypot(dx, dz);
            if (d > CFG.slapReach || Math.abs(r.y - b.y) > 7) continue;
            if ((dx * fx + dz * fz) / (d || 1) < -0.2 && d > 3) continue;
            if (d < bd) { bd = d; best = rid; }
        }
        if (best) { net.send('slap', { s: best, rb: id === 'rainbow' ? 1 : 0 }); const r = remotes.get(best); FX.slapBurst(FX.tmpV.set(r.x, r.y + 3, r.z), id === 'rainbow' ? 0xff5ab0 : 0xffd23a, 1); }
        return;
    }
    if (id === 'carpet') {
        if (!hasItem(S, 'carpet')) { openPanel('shop', 'gear'); return; }
        S.carpetOn = !S.carpetOn; storageSet('cs1_carpet', S.carpetOn ? '1' : '0');
        toast(S.carpetOn ? '🌈 Cloud Carpet on: hold JUMP while falling' : '🌈 Cloud Carpet off', S.carpetOn ? '#7dff6b' : '#ffffff');
        updateHud();
        return;
    }
    if (id === 'hop') {
        if (!hasItem(S, 'hop')) { openPanel('shop', 'gear'); return; }
        if (t - P.hopAt < CFG.hopGap) { toast('🚀 Rocket Hop is ready in ' + Math.ceil(CFG.hopGap - (t - P.hopAt)) + 's', '#ffe24a'); return; }
        P.hopAt = t;
        const b = P.b;
        b.vy = CFG.hopBoostV; b.onGround = false; b.ground = null; P.minVy = 0; P.peakY = b.y;
        playAsmr('mega', 0.6, 1.4); sfx('rankup');
        FX.ring(FX.tmpV.set(b.x, b.y + 0.4, b.z), 0xff8a3a, 9, 0.5);
        FX.powerFx(b, 0xff8a3a, 14);
        fovKick = 6; shake = Math.max(shake, 0.2);
        sendMove(true);
    }
};
actions.toolCooldown = (id) => {
    if (id === 'hop') return Math.max(0, CFG.hopGap - (clockT - P.hopAt)) / CFG.hopGap;
    if (id === 'glove' || id === 'rainbow') return Math.max(0, CFG.slapGap - (clockT - P.slapAt)) / CFG.slapGap;
    return 0;
};

function updateMe(dt) {
    const t = clockT, b = P.b;
    let f = 0, r = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    f -= touchMove.y + pad.ly; r += touchMove.x + pad.lx;
    cam.yaw -= pad.rx * 2.6 * dt * camSens;
    cam.pitch = clamp(cam.pitch + pad.ry * 1.7 * dt * camSens, -0.6, 1.3);
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    let mx = fx * f + rx * r, mz = fz * f + rz * r;
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    let hold = !!(keys.Space || touchJump || (pad.held && pad.held.has('A')));
    let pressed = t - P.jumpPress < 0.15;
    // QA autopilot drives instead
    if (P.auto) { const a = P.auto(dt); mx = a.mx; mz = a.mz; hold = a.hold; pressed = a.jump; }
    P.frozen = anyPopup() || switching;
    if (P.frozen) { mx = 0; mz = 0; pressed = false; hold = false; }
    if (P.stunT > 0) { P.stunT -= dt; mx *= 0.15; mz *= 0.15; pressed = false; }
    P.moving = mx * mx + mz * mz > 0.01;
    // holding JUMP keeps jumping
    if (hold && b.onGround && !pressed && t - P.lastJump > 0.12) pressed = true;
    gatherSolids();
    // standing on a sliding key: it carries you
    const G = b.onGround && b.ground;
    if (G && G.k && G.k.slide && G.n) {
        const k = G.k, now = srvT(), dv = slideV(k.slide, now) - slideV(k.slide, now - dt);
        const a = toWorld(G.n, 0, 0), c = toWorld(G.n, 0, 1);
        b.x += (c.x - a.x) * dv; b.z += (c.z - a.z) * dv;
    }
    const gk = G && G.k;
    const inp = {
        mx, mz, jump: pressed, hold, power: powerOf(S), double: hasItem(S, 'double'), speed: walkOf(S) / CFG.walk,
        glide: hasItem(S, 'carpet') && S.carpetOn, grip: gk && gk.kind === 'ice' ? 0.1 : 1, airGrip: P.stunT > 0 ? 0.06 : 1,
    };
    if (!b.onGround) P.minVy = Math.min(P.minVy, b.vy);
    const hs0 = Math.hypot(b.vx, b.vz), wasGround = b.onGround, y0 = b.y;
    const ev = stepBody(b, inp, dt, P.world);
    // walked up onto the next key: the body is there at once, you ease up onto it (a stride, not a teleport)
    if (wasGround && b.onGround && b.y - y0 > 0.2) P.stepOff = Math.max(-3, P.stepOff - (b.y - y0));
    if (!b.onGround) P.peakY = Math.max(P.peakY, b.y); else if (wasGround) P.peakY = b.y;
    // a key let go of (stepped or jumped off): it springs back up from the bottom
    if (G && G.k && G.min && !(b.onGround && b.ground && b.ground.k === G.k)) impact((G.min[0] + G.max[0]) / 2, G.max[1], (G.min[2] + G.max[2]) / 2, 1, 0.6, true);
    // running into a wall: a thud, a jolt
    if (P.moving && hs0 > 14 && Math.hypot(b.vx, b.vz) < hs0 * 0.25 && t - P.bumpAt > 0.5) { P.bumpAt = t; playAsmr('bonk', 0.4, 0.8); shake = Math.max(shake, 0.08); if (me) me.squash(0.25); }
    if (ev === 1 || ev === 2) {
        P.jumpPress = -9; P.lastJump = t;
        if (me) me.stretch(0.6);
        playAsmr('boost', ev === 2 ? 0.3 : 0.2, (ev === 2 ? 1.5 : 1.25) + RND() * 0.1);
        if (ev === 2) FX.ring(FX.tmpV.set(b.x, b.y + 0.3, b.z), 0xffffff, 5, 0.4);
        P.minVy = 0;
        fovKick = 2.2;
    } else if (ev === 3 || ev === 4) onLand(t);
    if (P.moving) P.facing = lerpA(P.facing, Math.atan2(mx, mz), 1 - Math.exp(-dt * 14));
    // the Cloud Carpet's whoosh
    if (b.glide) { P.glideSnd -= dt; if (P.glideSnd <= 0) { P.glideSnd = 0.35; playAsmr('boost', 0.06, 0.6); } FX.trailDot(b.x, b.y - 0.3, b.z, RND() < 0.5 ? 0xff9ad6 : 0x8ae8ff, 0.6); }
    // footsteps: a clack on every key, a soft step on the plaza
    P.onKey = !!(b.onGround && b.ground && (b.ground.k || b.ground.landing));
    if (b.onGround && P.moving) {
        P.stride += dt * CFG.walk * (walkOf(S) / CFG.walk) / 5;
        if (Math.floor(P.stride) !== P.lastStride) {
            P.lastStride = Math.floor(P.stride);
            if (P.onKey) { const n = b.ground.n || b.ground.landing || 1; playAsmr('k_' + zoneOf(n).sound, 0.26, 0.95 + RND() * 0.12); }
            else playAsmr('crunch', 0.28, 1 + RND() * 0.2);
        }
    }
    touchGround(t);
    // fell well below your checkpoint (or off the tower onto the plaza): back on your checkpoint
    const cpY = landingTop(S.cp || 1);
    if (!switching && t - P.fallSent > 1.5) {
        // (falling: caught on the way down; walking about the plaza with a checkpoint up the tower is fine)
        const fellFar = (S.cp || 1) > 1 && b.y < cpY - CFG.fallBelow && !(b.onGround && b.y < 1);
        const landedOnPlaza = b.onGround && b.y < 0.5 && (S.cp || 1) > 1 && P.peakY - b.y > 22;
        if (fellFar || landedOnPlaza) { P.fallSent = t; net.send('respawn', { fell: 1 }); sfx('denied'); }
    }
    if (b.y < -40) { teleport(SPAWN.x, 0, SPAWN.z, Math.PI); }
    if (me) {
        // you go down with the key under you (eased over a few frames: it travels, it doesn't teleport)
        // (a landing's plate is a giant key: it goes down too)
        P.sink += ((P.onKey && b.onGround ? PRESSED_TRAVEL : 0) - P.sink) * (1 - Math.exp(-dt * 38));
        P.stepOff *= Math.exp(-dt * 15);
        const slap = t - P.slapT < 0.32 ? (t - P.slapT) / 0.32 : 0;
        me.update(dt, t, {
            x: b.x, y: b.y - P.sink + P.stepOff, z: b.z, ry: P.facing, snapRy: true, air: !b.onGround, moving: P.moving && b.onGround, speed: Math.hypot(b.vx, b.vz),
            vy: b.vy, jump: ev === 1, airJump: ev === 2, ground: 0, pose: b.glide ? 'swing' : P.stunT > 0 && !b.onGround ? 'flip' : null, slap, hold: slap > 0,
        });
        placeTeam(me.buddyPos, S.team || [], b.x, b.onGround ? b.y : b.y - 3, b.z, P.facing, t, dt);
    }
    sendMove(false);
}
// a landing: the key under you clacks (a bounce key throws you up, a dropping key starts to go)
function onLand(t) {
    const b = P.b, G = b.ground, k = clamp(-P.minVy / 60, 0.3, 1.4);
    if (me) me.squash(k);
    P.minVy = 0;
    if (G && G.k) {
        const key = G.k, n = G.n;
        impact(b.x, b.y, b.z, Math.min(1.2, k), 3.5);
        if (view) view.lightKey(n, key);
        playAsmr('k_' + zoneOf(n).sound, 0.5, 0.9 + RND() * 0.1);
        if (k > 0.8) playAsmr('land', 0.35, 1);
        // a hard landing: dust off the cap, a spray of sparks in the key's LED colour, a jolt
        if (k > 0.55) {
            FX.dust(FX.tmpV.set(b.x, b.y - PRESSED_TRAVEL, b.z), Math.round(3 + k * 5), 0.6 + k * 0.5, 0x6a6478);
            FX.popSpark(FX.tmpV.set(b.x, b.y - 0.3, b.z), key.kind === 'bounce' ? 0x46ff6a : zoneOf(n).led);
            shake = Math.max(shake, 0.05 * k);
        }
        if (key.kind === 'bounce') {
            b.vy = CFG.bounceV; b.onGround = false; b.ground = null; P.peakY = b.y;
            playAsmr('mega', 0.5, 1.6); sfx('lucky');
            FX.ring(FX.tmpV.set(b.x, b.y + 0.3, b.z), 0x46ec50, 9, 0.5);
            if (me) me.stretch(1);
            fovKick = 5;
            net.send('bounce', { n });
            sendMove(true);
        } else if (key.kind === 'drop' && !P.drops.has(key)) {
            P.drops.set(key, keysNow());
            if (view) view.dropKey(n, key, keysNow());
            playAsmr('crunch', 0.5, 0.6);
        }
    } else if (G && G.landing) {
        impact(b.x, b.y, b.z, Math.min(1.2, k), 6);
        playAsmr('land', 0.45, 0.95);
        if (k > 0.55) { FX.dust(FX.tmpV.set(b.x, b.y - PRESSED_TRAVEL, b.z), Math.round(4 + k * 6), 0.7 + k * 0.5, 0x6a6478); shake = Math.max(shake, 0.06 * k); }
        if (view) view.lightLanding(G.landing);
    } else playAsmr('thud', 0.4, 0.9);
}
// what you're standing on: a landing (your checkpoint, a new one pays), the coins round you
function touchGround(t) {
    const b = P.b;
    const G = b.onGround && b.ground;
    if (G && G.landing) {
        const n = G.landing;
        if ((n === (S.best || 1) + 1 || (n <= (S.best || 1) && n !== S.cp)) && t - (P.cpSent.get(n) || -9) > 1.2) {
            P.cpSent.set(n, t);
            sendMove(true);
            net.send('cp', { n });
            // (on your screen at once: the server's answer brings the Coins)
            if (n > (S.best || 1)) { FX.ring(FX.tmpV.set(b.x, b.y + 0.5, b.z), 0x7dff6b, 14, 0.6); confetti(b); }
        }
    }
    // the coins: within your Coin Magnet's reach
    if (view) {
        const reach = reachOf(S), now = clockT;
        for (const c of view.coins()) {
            if (Math.hypot(c.x - b.x, c.y - (b.y + 2.5), c.z - b.z) > reach) continue;
            if (c.n > (S.best || 1)) continue;
            const key = c.n + ':' + c.i;
            if (now - (P.coinAt.get(key) || -1e9) < CFG.coinBack) continue;
            P.coinAt.set(key, now);
            net.send('coin', { n: c.n, i: c.i });
            playAsmr('tick', 0.35, 1.6 + RND() * 0.2); sfx('coin');
            FX.coinBurst(FX.tmpV.set(c.x, c.y, c.z));
            floatText('+' + fmt(Math.round(pickupCoins(c.n) * coinMult(S, x2On(), rushOn()))), '#ffe24a', FX.tmpV.set(c.x, c.y + 2, c.z), 3.4, false);
        }
    }
}
const coinTaken = (n, i) => clockT - (P.coinAt.get(n + ':' + i) || -1e9) < CFG.coinBack;

// =====================================================================================
// The camera: close behind you (drag to turn, wheel / pinch to zoom)
// =====================================================================================
const cam = { yaw: 0, pitch: 0.32, dist: isTouch ? 24 : 21 };
let camD = 18, camSens = 1, camSnap = true, shake = 0, fovKick = 0;
const dirV = new V3(), pivotV = new V3(), backV = new V3(), camPos = new V3(), lookV = new V3();
let pivotY = 5;
function lookDir(out) { const p = cam.pitch, cp = Math.cos(p); return out.set(-Math.sin(cam.yaw) * cp, -Math.sin(p), -Math.cos(cam.yaw) * cp); }
const LZD = SUN_DIRECTION.clone().normalize(), LX = new V3(0, 1, 0).cross(LZD).normalize(), LY = LZD.clone().cross(LX), snapV = new V3();
function snapShadow(p) {
    const c = sun.shadow.camera, texel = (c.right - c.left) / sun.shadow.mapSize.x;
    const a = Math.round(p.dot(LX) / texel) * texel, b = Math.round(p.dot(LY) / texel) * texel;
    snapV.copy(LX).multiplyScalar(a).addScaledVector(LY, b).addScaledVector(LZD, p.dot(LZD));
    sun.target.position.copy(snapV);
    sun.position.copy(snapV).addScaledVector(LZD, 200);
}
const AX = [0, 1, 2], oA = [0, 0, 0], dA = [0, 0, 0];
function rayHit(o, d, maxT) {
    let best = maxT;
    oA[0] = o.x; oA[1] = o.y; oA[2] = o.z; dA[0] = d.x; dA[1] = d.y; dA[2] = d.z;
    for (const c of P.world.solids) {
        // (the pillar: the camera slides along it instead, updateCamera)
        if (c.wall || c.max[1] - c.min[1] < 3 || c.max[0] - c.min[0] < 2.5 || c.max[2] - c.min[2] < 2.5) continue;
        let t0 = 0, t1 = best, miss = false;
        for (const a of AX) {
            if (Math.abs(dA[a]) < 1e-9) { if (oA[a] < c.min[a] || oA[a] > c.max[a]) { miss = true; break; } continue; }
            let ta = (c.min[a] - oA[a]) / dA[a], tb = (c.max[a] - oA[a]) / dA[a];
            if (ta > tb) { const q = ta; ta = tb; tb = q; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { miss = true; break; }
        }
        if (!miss && t0 > 0 && t0 < best) best = t0;
    }
    return best;
}
// where a ray first enters one box (Infinity: it misses)
function rayBox(o, d, c, maxT) {
    oA[0] = o.x; oA[1] = o.y; oA[2] = o.z; dA[0] = d.x; dA[1] = d.y; dA[2] = d.z;
    let t0 = 0, t1 = maxT;
    for (const a of AX) {
        if (Math.abs(dA[a]) < 1e-9) { if (oA[a] < c.min[a] || oA[a] > c.max[a]) return Infinity; continue; }
        let ta = (c.min[a] - oA[a]) / dA[a], tb = (c.max[a] - oA[a]) / dA[a];
        if (ta > tb) { const q = ta; ta = tb; tb = q; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) return Infinity;
    }
    return t0;
}
function updateCamera(dt) {
    const b = P.b, portrait = innerWidth < innerHeight;
    lookDir(dirV);
    const gy = b.y + 5.2;
    if (camSnap || (pivotV.x - b.x) ** 2 + (pivotV.z - b.z) ** 2 + (pivotV.y - gy) ** 2 > 1600) { pivotV.set(b.x, gy, b.z); pivotY = gy; camSnap = false; }
    else {
        const kx = 1 - Math.exp(-dt * 16);
        pivotV.x += (b.x - pivotV.x) * kx; pivotV.z += (b.z - pivotV.z) * kx;
        pivotY += (gy - pivotY) * (1 - Math.exp(-dt * (b.onGround ? 10 : 7)));
        pivotV.y = pivotY;
    }
    backV.copy(dirV).negate();
    if (b.onGround) P.groundY = b.y;
    let lim = cam.dist + (portrait ? 7 : 0) + Math.min(10, Math.max(0, b.y - P.groundY) * 0.08);
    lim = Math.min(lim, rayHit(pivotV, backV, lim + 1) - 0.8);
    // the pillar behind you: come in toward you, but no closer than a few studs (the rest: slide along its face, below)
    const tw = rayBox(pivotV, backV, PILLAR, lim + 1);
    if (tw < lim) lim = Math.max(Math.min(lim, 12), tw - 0.8);
    lim = Math.max(2, lim);
    camD = lim < camD ? lim : camD + (lim - camD) * (1 - Math.exp(-dt * 4));
    camPos.copy(pivotV).addScaledVector(backV, camD);
    if (camPos.y < 0.8) camPos.y = 0.8;
    // behind you is the pillar's wall: the camera slides along it (out to the nearest face), never into it
    const PW = PILLAR.max[0] + 1.6;
    let pushed = false;
    if (Math.abs(camPos.x) < PW && Math.abs(camPos.z) < PW && camPos.y > PILLAR.min[1]) {
        const ox = PW - Math.abs(camPos.x), oz = PW - Math.abs(camPos.z);
        if (ox < oz) camPos.x = Math.sign(camPos.x || 1) * PW; else camPos.z = Math.sign(camPos.z || 1) * PW;
        pushed = true;
    }
    camera.position.copy(camPos);
    // (slid along the wall: still looking at you)
    if (pushed) camera.lookAt(lookV.copy(pivotV).addScaledVector(dirV, 6));
    else camera.lookAt(lookV.copy(camPos).addScaledVector(dirV, 30));
    if (shake > 0.001) { const s = shake * shake * 0.8; camera.position.x += (RND() * 2 - 1) * s; camera.position.y += (RND() * 2 - 1) * s; shake = Math.max(0, shake - dt * 2.4); }
    fovKick = Math.max(0, fovKick - dt * 9);
    const want = (portrait ? 84 : 70) + fovKick;
    if (Math.abs(camera.fov - want) > 0.01) { camera.fov += (want - camera.fov) * Math.min(1, dt * 10); camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    if (me) {
        const d = camera.position.distanceTo(FX.tmpV.set(b.x, b.y + 4, b.z));
        me.root.visible = d > 2.2;
        // your own tag: small up close, gone when the camera's right behind you
        if (me.label) { me.label.visible = d > 7; me.fitLabel(d); }
    }
}

// =====================================================================================
// Input
// =====================================================================================
const keys = {};
const touchMove = { x: 0, y: 0 };
let running = false, touchJump = false, paused = false;
actions.onPanel = (open) => {
    for (const k in keys) keys[k] = false; touchJump = false;
    if (!running) return;
    if (open) { BX.adScreen('panel'); BX.gameplayEnd(); } else { BX.adScreen('gameplay'); BX.gameplayStart(); }
};
const TOOLS = ['glove', 'carpet', 'hop', 'rainbow'];
addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.key === 'Enter') e.target.blur(); return; }
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    if (!running) return;
    if (e.code === 'Escape' && !e.repeat) { if (closeTop()) return; if (BX.isEmbedded()) BX.showPortalMenu(); else openPanel('settings'); return; }
    keys[e.code] = true;
    if (e.repeat || anyPopup()) return;
    if (e.code === 'Space') P.jumpPress = clockT;
    if (e.code === 'KeyE' && activePrompt) usePrompt();
    const d = /^Digit([1-4])$/.exec(e.code);
    if (d) actions.tool(TOOLS[+d[1] - 1]);
    if (e.code === 'KeyF') actions.tool(hasItem(S, 'rainbow') ? 'rainbow' : 'glove');
    if (e.code === 'KeyR') actions.respawn();
    if (e.code === 'KeyQ') openPanel('quests');
    if (e.code === 'KeyG') openPanel('shop');
    if (e.code === 'KeyB') openPanel('pals');
    if (e.code === 'KeyT') openPanel('stages');
    if (e.code === 'BracketLeft') actions.goto((S.cp || 1) - 1);
    if (e.code === 'BracketRight') actions.goto((S.cp || 1) + 1);
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; touchJump = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
const drags = new Map();
let pinchD = 0;
canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    if (!running || anyPopup()) return;
    canvas.setPointerCapture(e.pointerId);
    drags.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, at: performance.now() });
    if (drags.size === 2) { const [a, b] = [...drags.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) d.moved = true;
    if (drags.size === 2) {
        const [a, b] = [...drags.values()], nd = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchD) cam.dist = clamp(cam.dist * pinchD / Math.max(20, nd), 8, 48);
        pinchD = nd;
    } else if (d.moved) {
        const k = (e.pointerType === 'touch' ? 0.0068 : 0.0045) * camSens;
        cam.yaw -= (e.clientX - d.x) * k;
        cam.pitch = clamp(cam.pitch + (e.clientY - d.y) * k, -0.6, 1.3);
    }
    d.x = e.clientX; d.y = e.clientY;
});
// a click on the world that wasn't a drag (a mouse): the Bonk Glove
const endDrag = (e) => { const d = drags.get(e.pointerId); drags.delete(e.pointerId); if (drags.size < 2) pinchD = 0; if (d && e.type === 'pointerup' && !d.moved && e.pointerType === 'mouse' && performance.now() - d.at < 400 && running && !anyPopup()) actions.tool(hasItem(S, 'rainbow') ? 'rainbow' : 'glove'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 2, 8, 48); e.preventDefault(); }, { passive: false });
(function touchControls() {
    const stick = $('#stick'), knob = $('#knob');
    let id = null, rect = null;
    const set = (e) => {
        const r = rect;
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2, l = Math.hypot(dx, dy);
        if (l > max) { dx *= max / l; dy *= max / l; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchMove.x = dx / max; touchMove.y = dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; rect = stick.getBoundingClientRect(); stick.setPointerCapture(id); set(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; touchMove.x = touchMove.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const jb = $('#jumpBtn');
    jb.addEventListener('pointerdown', (e) => { e.preventDefault(); jb.setPointerCapture(e.pointerId); P.jumpPress = clockT; touchJump = true; jb.classList.add('on'); });
    const jEnd = () => { touchJump = false; jb.classList.remove('on'); };
    jb.addEventListener('pointerup', jEnd); jb.addEventListener('pointercancel', jEnd);
})();

// ----- proximity prompts (the Gear Shop, the Capsules, the Wheel, Restack, the boards) -----
let activePrompt = null;
const pv = new V3();
function updatePrompt() {
    let best = null, bd = 1e9;
    const b = P.b;
    if (!anyPopup() && b.y < 8) for (const p of prompts) { if (p.on && !p.on()) continue; const d = Math.hypot(p.pos.x - b.x, p.pos.z - b.z); if (d < p.r && d < bd) { bd = d; best = p; } }
    activePrompt = best;
    const el = $('#promptBtn');
    if (!best) { if (!el.hidden) el.hidden = true; return; }
    pv.copy(best.pos).setY(best.pos.y + 6).project(camera);
    if (pv.z > 1) { el.hidden = true; return; }
    el.hidden = false;
    const lbl = best.label();
    if ($('#promptTxt').textContent !== lbl) $('#promptTxt').textContent = lbl;
    el.style.transform = `translate(${((pv.x + 1) / 2 * innerWidth).toFixed(0)}px, ${((1 - pv.y) / 2 * innerHeight).toFixed(0)}px) translate(-50%, -110%)`;
}
function usePrompt() { if (activePrompt) { sfx('click'); activePrompt.act(); } }
$('#promptBtn').addEventListener('click', usePrompt);

// ----- controller -----
function padButtons() {
    if (!pad.connected || !running) return;
    if (pad.pressed.has('BACK') || pad.pressed.has('START')) { if (!closeTop()) openPanel('settings'); return; }
    if (anyPopup()) { if (pad.pressed.has('B')) closeTop(); return; }
    if (pad.pressed.has('A')) P.jumpPress = clockT;
    if (pad.pressed.has('X')) { if (activePrompt) usePrompt(); else actions.tool(hasItem(S, 'rainbow') ? 'rainbow' : 'glove'); }
    if (pad.pressed.has('Y')) actions.tool('hop');
    if (pad.pressed.has('B')) actions.tool('carpet');
    if (pad.pressed.has('LB')) actions.goto((S.cp || 1) - 1);
    if (pad.pressed.has('RB')) actions.goto((S.cp || 1) + 1);
}

// =====================================================================================
// Everyone else on the tower (smoothed on the server's clock)
// =====================================================================================
const remotes = new Map();
const smp = { x: 0, y: 0, z: 0, ry: 0, a: 0, speed: 0 };
const remSt = { x: 0, y: 0, z: 0, ry: 0, air: false, moving: false, speed: 0, vy: 0, far: false, ground: 0, pose: null, slap: 0, hold: false };
class Remote {
    constructor(p, id) {
        this.id = id;
        this.char = new Char({ name: p.name, lv: tagLine(p.top, p.wins), tr: p.title });
        this.char.setAvatar(p.av);
        this.av = p.av; this.track = new Track(); this.air = false; this.prevY = p.y; this.vy = 0; this.minVy = 0; this.buddyPos = []; this.team = []; this.teamKey = ''; this.trailKey = null; this.slapT = -9; this.sink = 0;
    }
    update(p, dt, t) {
        this.track.push(p.t, p.x, p.y, p.z, p.ry, p.anim);
        const rt = net.now() - this.track.delayFor(dt);
        if (!this.track.sample(rt, smp, dt)) { smp.x = p.x; smp.y = p.y; smp.z = p.z; smp.ry = p.ry; smp.a = p.anim; smp.speed = 0; }
        const air = smp.a >= 2, vy = dt > 0 ? (smp.y - this.prevY) / dt : 0;
        this.vy += (vy - this.vy) * Math.min(1, dt * 12);
        if (air) this.minVy = Math.min(this.minVy, this.vy);
        if (this.air && !air) { landAt(smp.x, smp.y, smp.z, clamp(-this.minVy / 60, 0.3, 1.3)); this.char.squash(0.6); this.minVy = 0; }
        if (!this.air && air && this.vy > 3) { this.char.stretch(0.5); if (this.prevY > 0.6 && camera.position.distanceToSquared(FX.tmpV.set(smp.x, smp.y, smp.z)) < 120 * 120) impact(smp.x, this.prevY, smp.z, 1, 1.4, true); }
        this.air = air; this.prevY = smp.y;
        if (p.av !== this.av) { this.av = p.av; this.char.setAvatar(p.av); }
        if (p.top !== this.tagT || p.name !== this.tagN || p.wins !== this.tagW) { this.tagT = p.top; this.tagN = p.name; this.tagW = p.wins; this.char.setLabel(p.name, tagLine(p.top, p.wins), p.title); }
        if (p.team !== this.teamKey) { this.teamKey = p.team; this.team = p.team ? p.team.split(',').filter((id) => buddyById[id]) : []; }
        if (p.trail !== this.trailKey) { this.trailKey = p.trail; const tr = trailById[p.trail]; this.char.setCombo(tr && tr.id ? 9 : 0, tr ? tr.color : 0xffffff, !!(tr && tr.rainbow)); if (this.char.aura) this.char.aura = 0; }
        const d2 = camera.position.distanceToSquared(FX.tmpV.set(smp.x, smp.y, smp.z)), near = d2 < (lowQ() ? 170 * 170 : 260 * 260);
        this.char.setVisible(near);
        if (near) {
            this.char.fitLabel(Math.sqrt(d2));
            const q = remSt;
            const onKey = !air && smp.y > 0.6;
            this.sink += ((onKey ? PRESSED_TRAVEL : 0) - this.sink) * (1 - Math.exp(-dt * 38));
            q.x = smp.x; q.y = smp.y - this.sink; q.z = smp.z; q.ry = smp.ry; q.air = air; q.moving = smp.a === 1 || smp.speed > 2; q.speed = smp.speed; q.vy = this.vy; q.far = d2 > 110 * 110;
            q.pose = smp.a === 3 ? 'swing' : null;
            const sl = t - this.slapT; q.slap = sl < 0.32 ? sl / 0.32 : 0; q.hold = q.slap > 0;
            this.char.update(dt, t, q);
            if (smp.a === 3 && !q.far) FX.trailDot(smp.x, smp.y - 0.3, smp.z, RND() < 0.5 ? 0xff9ad6 : 0x8ae8ff, 0.6);
            if (d2 < 120 * 120) placeTeam(this.buddyPos, this.team, smp.x, air ? smp.y - 3 : smp.y, smp.z, smp.ry, t, dt);
        }
        this.x = smp.x; this.y = smp.y; this.z = smp.z; this.onGround = !air;
    }
    dispose() { this.char.dispose(); }
}
const lowQ = () => getQuality() === 'low';
function panOf(x, z) {
    const dx = x - camera.position.x, dz = z - camera.position.z;
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    return clamp((dx * rx + dz * rz) / 40, -0.8, 0.8);
}
// someone else's landing: the keys under them clack, quietly
function landAt(x, y, z, k) {
    const d = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
    if (d > 120) return;
    impact(x, y, z, Math.min(1, k), 3);
    playAsmr('k_' + zoneOf(stageAtY(Math.max(1, y))).sound, 0.25 * (1 - d / 120), 1, panOf(x, z));
}
const seenIds = new Set();
const gaugeList = [];
function syncRemotes(dt, t) {
    const room = net.room;
    if (!room || !room.state || !room.state.players) return;
    seenIds.clear();
    gaugeList.length = 0;
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId) { if (S.name !== p.name) { S.name = p.name; labelMe(true); } return; }
        seenIds.add(id);
        let r = remotes.get(id);
        if (!r) {
            r = new Remote(p, id); remotes.set(id, r);
            if (!p.bot) { if (clockT > 4) { BX.playerJoined(p.name); toast('🧗 ' + p.name + ' joined!', '#7de8ff'); } else BX.playerInRoom(p.name); }
        }
        r.update(p, dt, t);
        gaugeList.push({ n: p.name, s: Math.max(1, stageAtY(Math.max(1, r.y || p.y))), me: false });
    });
    for (const [id, r] of remotes) if (!seenIds.has(id)) { r.dispose(); remotes.delete(id); }
}
// your own name tag
let labelAt = 0;
function labelMe(force) {
    const now = performance.now();
    if (!me || (!force && now - labelAt < 400)) return;
    labelAt = now;
    me.setLabel(S.name, tagLine(S.top, S.wins), titleOf(S.top));
}
let myTrail = null;
function syncMyTrail() {
    if (!me || myTrail === S.trail) return;
    myTrail = S.trail;
    const tr = trailById[S.trail];
    me.setCombo(tr && tr.id ? 9 : 0, tr ? tr.color : 0xffffff, !!(tr && tr.rainbow));
    me.aura = 0;
}
// where everyone stands (the keys under them are down): the nearest 8
const pressList = [], pressPool = [];
const pressOf = (i, x, y, z, d) => { const p = pressPool[i] || (pressPool[i] = [0, 0, 0, 0]); p[0] = x; p[1] = y; p[2] = z; p[3] = d; return p; };
function updatePresses() {
    pressList.length = 0;
    const b = P.b;
    if (b.onGround) pressList.push(pressOf(0, b.x, b.y, b.z, 0));
    for (const o of remotes.values()) if (o.onGround && o.x !== undefined && pressList.length < 24) pressList.push(pressOf(pressList.length, o.x, o.y, o.z, (o.x - b.x) ** 2 + (o.y - b.y) ** 2 + (o.z - b.z) ** 2));
    if (pressList.length > 8) pressList.sort((a, c) => a[3] - c[3]);
    for (let i = 0; i < 8; i++) { const p = pressList[i]; if (p) PRESS.value[i].set(p[0], p[1], p[2], 1); else PRESS.value[i].w = 0; }
    PRESS_N.value = Math.min(8, pressList.length);
}

// =====================================================================================
// HUD buttons
// =====================================================================================
let switching = false;
const bind = (sel, fn) => $(sel).addEventListener('click', (e) => { sfx('click'); e.currentTarget.blur(); fn(); });
bind('#bShop', () => openPanel('shop'));
bind('#bPals', () => openPanel('pals'));
bind('#bQuests', () => openPanel('quests'));
bind('#bDaily', () => openPanel('daily'));
bind('#bSpin', () => openPanel('spin'));
bind('#bRestack', () => openPanel('restack'));
bind('#bRanks', () => openPanel('ranks'));
bind('#bStages', () => openPanel('stages'));
bind('#bSettings', () => openPanel('settings'));
bind('#bGift', () => openPanel('gifts'));
bind('#questLine', () => openPanel('quests'));
bind('#gemsBox', () => openPanel('shop', 'gems'));
bind('#coinBox', () => openPanel('shop'));
bind('#bX2', () => openPanel('shop', 'gems'));
bind('#bAdX2', () => actions.adX2());
bind('#bPrev', () => actions.goto((S.cp || 1) - 1));
bind('#bNext', () => actions.goto((S.cp || 1) + 1));
bind('#bBest', () => actions.goto(S.best || 1));
bind('#stageNum', () => openPanel('stages'));
bind('#bSkip', () => actions.skip());
bind('#bAdSkip', () => actions.adSkip());
for (const el of document.querySelectorAll('#hotbar [data-tool]')) el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); actions.tool(el.dataset.tool); });
function fadeOut() { $('#fade').style.opacity = 1; return sleep(260); }
function fadeIn() { $('#fade').style.opacity = 0; }
let showFps = false;
actions.fpsOn = () => showFps;
actions.saveSetting = (o) => BX.saveSettings(o);
actions.toggleFps = () => { showFps = !showFps; $('#fps').hidden = !showFps; };
let boards = { top: [], time: [] };
actions.boards = () => boards;
actions.canOpenBoards = () => BX.isEmbedded();
actions.openBoard = (id) => { if (!BX.openLeaderboard(id)) toast('The full leaderboards are on Bloxity', '#ffffff'); };
let hatchWant = null, hatchAuto = false;
actions.hatch = (c, n) => { hatchWant = { c, n }; net.send('box', { id: c, n }); };
actions.onHatched = (out) => {
    screenConfetti(40);
    const best = out.slice().sort((a, b) => buddyById[b.id].mult - buddyById[a.id].mult)[0], k = buddyById[best.id];
    if (k.rarity === 'legendary' || k.rarity === 'epic') { sfx('rankup'); screenConfetti(90); }
    if (me) FX.sparkleColumn(P.b, k.c1);
};
actions.afterHatch = () => { if (hatchAuto && hatchWant) net.send('box', { id: hatchWant.c, n: hatchWant.n }); };
addEventListener('resize', () => measureHud());

// =====================================================================================
// Networking
// =====================================================================================
const BLOXITY_GAME_ID = import.meta.env.VITE_BLOXITY_GAME_ID || '';
// Hosted on Boxity: every connect resolves a pod through the Boxity matchmaker (never the fixed <id>.host route); retried with a
// backoff while a server wakes up. Locally: the same server that serves the page (or the dev server's game port).
let relayId = '';
async function serverEndpoint() {
    if (BLOXITY_GAME_ID && BX.bloxity.available()) {
        const t0 = Date.now();
        let wait = 1200;
        while (Date.now() - t0 < 60000) {
            const r = await BX.resolveEndpoint(BLOXITY_GAME_ID);
            if (r && r.endpoint) { relayId = r.roomId || ''; if (r.cold) loadingText('Waking up a server…'); return r.endpoint; }
            loadingText('Waking up a server…');
            await sleep(wait); wait = Math.min(8000, wait * 1.6);
        }
        throw new Error('the Boxity matchmaker did not answer');
    }
    // (VITE_SERVER_URL: local test runs only, a game server on another local port)
    return import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:3163` : location.origin);
}
let lastMoveSent = 0, lastMoveKey = '';
function sendMove(force) {
    if (switching) return;
    const now = performance.now();
    if (!force && now - lastMoveSent < 66) return;
    const b = P.b;
    const a = b.glide ? 3 : !b.onGround ? 2 : P.moving ? 1 : 0;
    const m = { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), ry: +P.facing.toFixed(3), a };
    const key = m.x + ',' + m.y + ',' + m.z + ',' + m.ry + ',' + a;
    if (!force && key === lastMoveKey && now - lastMoveSent < 500) return;
    lastMoveKey = key; lastMoveSent = now;
    m.ts = Math.round(net.now());
    net.send('move', m);
}
function playerUid() {
    let uid = storageGet('cs1_uid');
    if (!uid) { uid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); storageSet('cs1_uid', uid); }
    return uid;
}
let gotProfile = false, lastGems = 0, connLost = false, leaving = false, epochSet = false;
// a room by its id (?roomId= from Boxity's Open Rooms / an invite): 'relay~colyseus' joins that pod's room straight away
async function joinById(roomParam, opts) {
    const [relay, rid] = roomParam.includes('~') ? roomParam.split('~') : ['', roomParam];
    if (relay) { const c = new Client(BX.env().playUrl.replace(/^http/, 'ws') + '/v1/ws/' + relay); relayId = relay; return c.joinById(rid, opts); }
    if (BLOXITY_GAME_ID) {
        const r = await fetch(BX.env().playUrl + '/v1/dir/' + BLOXITY_GAME_ID + '/list').then((x) => x.json()).catch(() => null);
        const e = r && Array.isArray(r.rooms) ? r.rooms.find((x) => x.id === rid || x.roomId === rid || x.colyseusRoomId === rid) : null;
        if (e && e.joinUrl) return new Client(e.joinUrl).joinById(rid, opts);
    }
    return null;
}
async function connect(name, endpoint) {
    const id = BX.identity();
    const opts = { uid: playerUid(), name: name || id.name, token: id.token, av: packAvatar(BX.currentAvatar()), save: storageGet('cs1_save') || '' };
    let room = null;
    const wantRoom = new URLSearchParams(location.search).get('roomId');
    if (wantRoom && !connect.tried) { connect.tried = true; try { room = await joinById(wantRoom, opts); } catch (e) { room = null; } }
    if (!room) { const url = endpoint || await serverEndpoint(); room = await new Client(url).joinOrCreate('tower', opts); }
    net.room = room;
    net.bloxity = false;
    BX.updateRoom(relayId ? relayId + '~' + room.roomId : room.roomId);
    room.onMessage('hello', (m) => { net.offset = m.now - Date.now(); if (!epochSet) { epochSet = true; setEpoch(m.now - 300000); } net.bloxity = !!m.bloxity; pingSend(); });
    room.onDrop(() => { toast('📶 Connection lost: reconnecting…', '#ffe24a'); });
    room.onReconnect(() => { toast('📶 Back online!', '#7dff6b'); });
    room.onMessage('pong', onPong);
    room.onMessage('profile', (m) => {
        const first = !gotProfile;
        if (m.save) storageSet('cs1_save', m.save);
        delete m.now; delete m.save;
        const best0 = S.best;
        Object.assign(S, m);
        S.profileAt = Date.now();
        gotProfile = true;
        if (!first && m.gems > lastGems) { bump('#gemsBox'); sfx('gem'); }
        lastGems = m.gems;
        labelMe(true);
        syncMyTrail();
        if (view && S.best !== best0) view.setGoal((S.best || 1) + 1);
        refreshPanels();
        updateHud();
    });
    // while climbing: only what changes then
    room.onMessage('lite', (m) => {
        const best0 = S.best;
        Object.assign(S, m);
        if (view && S.best !== best0) view.setGoal((S.best || 1) + 1);
        S.profileAt = S.profileAt || Date.now();
        labelMe(false);
        updateHud();
    });
    room.onMessage('toast', (m) => toast(m.text, m.color));
    room.onMessage('toastreward', (m) => { toast(m.text, '#7dff6b'); sfx('gem'); });
    room.onMessage('broke', (m) => notEnough(m));
    room.onMessage('code', (m) => codeResult(m));
    room.onMessage('boards', (m) => { boards = m; if (view) view.setBoards(m); if (panelIs('ranks')) refreshPanels(); });
    room.onMessage('reward', (m) => { popup(m.gems && !/cc/.test(m.text) ? '💎' : '🎁', m.why || 'Reward!', m.text, '#ffe24a', true); sfx('reward'); confetti(P.b); if (/cc/.test(m.text)) flyCoins(6); });
    room.onMessage('landed', (m) => onLanded(m));
    room.onMessage('coin', (m) => { if (m.lucky) { sfx('lucky'); floatText('LUCKY x5 +' + fmt(m.got), '#ffe24a', FX.tmpV.set(P.b.x, P.b.y + 8, P.b.z), 5, true); } flyCoins(1); });
    room.onMessage('summitfx', (m) => { const r = remotes.get(m.s); if (r) { FX.fireworks(FX.tmpV.set(r.x, r.y + 8, r.z), lowQ() ? 1 : 3); } toast('🏆 ' + m.name + ' reached Summit ' + Math.floor((m.n - 1) / 10) + '!', '#ffd23a'); });
    room.onMessage('rush', () => { sfx('rankup'); playAsmr('mega', 0.6, 1.2); bigText('🌈 RAINBOW RUSH! x3 COINS!', '#ff9ad6'); screenConfetti(lowQ() ? 40 : 90); toast('🌈 Every coin and landing pays x3 for ' + CFG.rushSecs + ' seconds!', '#ff9ad6'); });
    room.onMessage('slapfx', (m) => {
        const a = m.a === room.sessionId ? null : remotes.get(m.a);
        if (a) a.slapT = clockT;
        const tb = m.b === room.sessionId ? P.b : remotes.get(m.b);
        if (tb && tb.x !== undefined) {
            const d = Math.hypot(tb.x - camera.position.x, tb.z - camera.position.z);
            if (d < 120) { playAsmr('bonk', 0.5 * (1 - d / 120), 1.1, panOf(tb.x, tb.z)); FX.slapBurst(FX.tmpV.set(tb.x, tb.y + 3, tb.z), m.rb ? 0xff5ab0 : 0xffd23a, 1); }
        }
    });
    room.onMessage('bonked', (m) => {
        const b = P.b;
        b.vx += m.dx * m.p; b.vz += m.dz * m.p; b.vy = Math.max(b.vy, CFG.slapLift); b.onGround = false; b.ground = null;
        P.stunT = 0.55; P.peakY = b.y;
        shake = Math.max(shake, 0.4);
        bigText('BONK!', m.rb ? '#ff5ab0' : '#ffd23a');
        toast('🥊 ' + m.from + ' bonked you!', '#ff9a8a');
        if (me) me.squash(1);
        sendMove(true);
    });
    room.onMessage('warped', (m) => warpTo(m.x, m.y, m.z, m.ry, m.why));
    room.onMessage('restacked', (m) => {
        sfx('rankup');
        popup('🔁', 'RESTACK ' + m.r + '!', 'Coins x' + (1 + 0.5 * m.r) + ' for good · +' + m.gems + ' 💎', '#ff9ad6');
        screenConfetti(90);
        P.coinAt.clear(); P.cpSent.clear();
    });
    room.onMessage('spun', (m) => onSpun(m));
    room.onMessage('bought', (m) => {
        sfx('buy');
        screenConfetti(50);
        if (m.what === 'item') { const it = itemById[m.id]; if (it) { toast(it.icon + ' ' + it.name + '! ' + it.text, '#7dff6b'); if (m.id === 'carpet') S.carpetOn = true; } }
        if (m.what === 'trail') toast('✨ ' + trailById[m.id].name + ' trail on!', '#7dff6b');
    });
    room.onMessage('adx2', (m) => { if (m.ok) { sfx('buy'); toast('⚡ x2 Coins for ' + m.mins + ' minutes!', '#7dff6b'); screenConfetti(50); } else toast('The ad couldn\'t be checked: try again later', '#ff9a8a'); });
    room.onMessage('adfail', () => toast('The ad couldn\'t be checked: try again later', '#ff9a8a'));
    room.onMessage('hatched', (m) => showHatch(m.c, m.out));
    room.onMessage('taskdone', (m) => { sfx('task'); toast('✅ Daily task done: ' + TASKS[m.k].text + '! Claim it in Quests', '#7dff6b'); });
    room.onMessage('questdone', () => { if (tutStep >= 0 && tutStep < TUT.length) return; sfx('task'); toast('🎯 Quest complete! Tap the quest to claim', '#7dff6b'); });
    room.onMessage('authed', (m) => { S.name = m.name; labelMe(true); });
    room.onMessage('snap', (m) => { P.snaps++; teleport(m.x, m.y, m.z); });
    room.onMessage('emote', (m) => { const r = remotes.get(m.s); if (r && r.char.blox) playEmoteOn(r.char.blox, m.id); });
    room.onMessage('chat', (m) => { if (BX.hasChat()) return; const r = remotes.get(m.s); if (r) chatBubble(r.char.root, m.text); else if (m.s === room.sessionId && me) chatBubble(me.root, m.text); });
    room.onLeave((code) => {
        if (leaving) return;
        running = false; connLost = true;
        audioAway(true);
        // a normal end: another tab took over. Anything else: find a server again and rejoin
        if (code === 4000) { showConnErr('You joined from somewhere else.'); return; }
        rejoin();
    });
    return room;
}
// a landing reached (the server's answer): a new one's Coins, a Summit's Win
let summitAt = 0;
function onLanded(m) {
    const b = P.b;
    if (m.again) { floatText('+' + fmt(m.got), '#ffe24a', FX.tmpV.set(b.x, b.y + 8, b.z), 4, true); sfx('coin'); flyCoins(3); return; }
    S.best = Math.max(S.best || 1, m.n); S.cp = m.n;
    if (view) { view.setGoal(m.n + 1); view.lightLanding(m.n); }
    if (m.win) {
        sfx('rankup'); playAsmr('mega', 0.7, 0.9);
        FX.fireworks(FX.tmpV.set(b.x, b.y + 12, b.z), lowQ() ? 3 : 7);
        screenConfetti(lowQ() ? 80 : 160);
        shake = Math.max(shake, 0.3);
        summitAt = clockT;
        summitCard({ n: m.n, got: m.got, gems: m.gems, wins: S.wins, zone: zoneOf(m.n).name, sky: skyOf(m.n).name }, () => { BX.adScreen('gameplay'); });
        BX.adScreen('results');
    } else {
        sfx('task'); playAsmr('land', 0.5, 1.2);
        bigText(m.skipped ? 'SKIPPED TO ' + m.n + '!' : 'STAGE ' + (m.n - 1) + ' CLEAR! +' + fmt(m.got), m.skipped ? '#8ae8ff' : '#7dff6b');
        if (!m.skipped) flyCoins(4);
        // a new zone: its name
        if ((m.n - 1) % 10 === 0 && m.n > 1) setTimeout(() => toast('🌈 ' + zoneOf(m.n).name, '#' + zoneOf(m.n).led.toString(16).padStart(6, '0')), 900);
    }
    const sk = skyOf(m.n);
    if (sk.from === m.n) setTimeout(() => bigText(sk.name.toUpperCase(), '#ffffff'), 1600);
    updateHud();
}
function showConnErr(text) {
    $('#start').hidden = false; $('#start').style.opacity = ''; $('#connectErr').hidden = false; $('#connectErr').textContent = text; $('#retryBtn').hidden = false; $('#loading').textContent = '';
}
async function rejoin() {
    $('#start').hidden = false; loadingText('Reconnecting…');
    for (let k = 0; k < 6; k++) {
        try {
            for (const r of remotes.values()) r.dispose();
            remotes.clear();
            gotProfile = false;
            await connect(BX.identity().loggedIn ? '' : (storageGet('cs1_name') || ''));
            const t0 = performance.now();
            while (!gotProfile && performance.now() - t0 < 6000) await sleep(50);
            connLost = false; running = true; audioAway(false);
            const p = net.room.state.players.get(net.room.sessionId);
            if (p) teleport(p.x, p.y, p.z, p.ry);
            $('#start').hidden = true;
            return;
        } catch (e) { await sleep(2000 * (k + 1)); }
    }
    showConnErr('Lost the connection to the server.');
}
// sent somewhere (a landing, the plaza): behind a short fade when it's far
async function warpTo(x, y, z, ry, why) {
    const b = P.b, far = Math.hypot(x - b.x, y - b.y, z - b.z) > 30;
    if (far) { switching = true; await fadeOut(); switching = false; }
    teleport(x, y, z, ry);
    if (far) fadeIn();
    FX.sparkleColumn(P.b, why === 'fell' ? 0xff9ad6 : 0x7dff6b);
    if (why === 'fell') toast('☁️ Back on your checkpoint: stage ' + (S.cp || 1), '#ffffff');
}
async function playEmoteOn(avatar, id) {
    if (!avatar) return;
    const cat = await BX.loadEmotes();
    const e = cat.get(id);
    if (e && e.clip) avatar.playEmote(e.clip);
}
function chatBubble(group, text) {
    if (!group) return;
    if (group.userData.bubbleLbl) { group.remove(group.userData.bubbleLbl); group.userData.bubbleLbl.material.map.dispose(); }
    const lb = billboard([{ t: '💬 ' + text, c: '#ffffff', s: '#10203a', px: 44 }], 9, 1024, new V3(0, 12, 0), group);
    group.userData.bubbleLbl = lb;
    setTimeout(() => { if (group.userData.bubbleLbl === lb) { group.remove(lb); lb.material.map.dispose(); group.userData.bubbleLbl = null; } }, BX.bubbleSeconds() * 1000);
}
// a Boxity chat line over its sender's head (keyed by their Boxity id)
function onBoxityChat(m) {
    let root = null;
    if (m.isLocalPlayer) root = me && me.root;
    else { const uid = String(m.userId || '').replace(/^legion_/, ''); const room = net.room; if (room && room.state) room.state.players.forEach((p, id) => { if (p.bx && p.bx === uid) { const r = remotes.get(id); if (r) root = r.char.root; } }); }
    if (!root) return;
    const text = BX.bubbleText(m);
    if (!BX.attachBubble(T, root, text)) chatBubble(root, text);
}
// the daily reward pops up on the plaza, on the ground
function offerDaily() {
    if (!running || !P.b.onGround || anyPopup() || offerDaily.done) return;
    if (!dailyStatus(S.daily, net.now()).can) return;
    offerDaily.done = true;
    openPanel('daily');
}

// ----- the guide for someone new: a step at a time, in the quest's place -----
const TUT = [
    { text: 'Walk to the glowing landing ahead (WASD)', done: () => P.b.y > 0.6 || (S.best || 1) > 1, touch: 'Walk to the glowing landing ahead (stick)' },
    { text: 'Walk up the keys to landing 2 (SPACE jumps the gaps)', done: () => (S.best || 1) >= 2, touch: 'Walk up the keys to landing 2 (JUMP for the gaps)' },
    { text: 'Grab a floating coin on the stairs', done: () => (S.pickups || 0) >= 1 },
    { text: 'Climb to stage 4: every new landing pays Coins', done: () => (S.best || 1) >= 4 },
];
let tutStep = -1;
function updateTutorial() {
    if (!running) return;
    if (tutStep < 0) { tutStep = (S.tut || 0) >= TUT.length || (S.best || 1) >= 4 ? TUT.length : (S.tut || 0); }
    if (tutStep >= TUT.length) { setTutorial(null); return; }
    const st = TUT[tutStep];
    if (st.done()) {
        tutStep++;
        net.send('tut', { tut: tutStep });
        sfx('task');
        if (tutStep >= TUT.length) { setTutorial(null); toast('🎉 You\'re climbing! Spend your Coins at the Gear Shop (G)', '#7dff6b'); return; }
    }
    const cur = TUT[tutStep];
    setTutorial({ text: isTouch && cur.touch ? cur.touch : cur.text, step: tutStep, of: TUT.length });
}

// =====================================================================================
// Every frame
// =====================================================================================
let clockT = 0, slowT = 0, pingT = 0, metaT = 20, tutT = 0, moodName = '', songName = '';
function update(dt) {
    clockT += dt;
    const t = clockT;
    CU.uNow.value = rel(net.now());
    tickKeys();
    pumpAvatars();
    beginBuddies();
    updateMe(dt);
    prof.mark('player');
    updatePrompt();
    syncRemotes(dt, t);
    prof.mark('others');
    updatePresses();
    syncMyTrail();
    tutT -= dt;
    if (tutT <= 0) { tutT = 0.25; updateTutorial(); }
    // the sky follows how high you are; the RAINBOW RUSH lights every key
    const s = stageAtY(Math.max(1, P.b.y)), mood = P.b.y < 4 ? 'dusk' : skyOf(s).mood;
    if (mood !== moodName) { moodName = mood; setMood(mood, false); }
    const rush = rushOn();
    FRENZY.value += ((rush ? 1 : 0) - FRENZY.value) * Math.min(1, dt * 3);
    setRush(rush ? (net.room.state.rush - net.now()) / 1000 : 0);
    contactShadows();
    endBuddies();
    updateEffects(dt);
    updateFx(dt);
    animateCounters(dt);
    slowT -= dt;
    if (slowT <= 0) {
        slowT = 0.5;
        gaugeList.push({ n: S.name || 'You', s: s, me: true });
        setGauge(gaugeList, S.best || 1);
        updateHud();
    }
    // the easy song on the plaza, the driving one on the tower
    const song = P.b.y > 6 || rush ? 'climb' : 'plaza';
    if (song !== songName) { songName = song; setMusicMode(song); }
    pingT -= dt;
    if (pingT <= 0) { pingT = pingEvery(); pingSend(); }
    metaT -= dt;
    if (metaT <= 0) { metaT = 30; sendMeta(); }
}
// the contact shadows (Low quality)
function contactShadows() {
    if (window.__noPhysics) return;
    SH.shadowsOn(getQuality() === 'low');
    SH.begin();
    const b = P.b;
    SH.add(b.x, b.onGround ? b.y : groundUnder(b), b.z, b.y, 3);
    for (const r of remotes.values()) if (r.x !== undefined && r.onGround) SH.add(r.x, r.y, r.z, r.y, 3);
    SH.end();
}
function groundUnder(b) { let best = 0; for (const s of P.world.solids) if (b.x > s.min[0] && b.x < s.max[0] && b.z > s.min[2] && b.z < s.max[2] && s.max[1] <= b.y + 0.1 && s.max[1] > best) best = s.max[1]; return best; }
const AMB = { color: 0xfff0f8, dir: 0.3, snow: false };
function updateCameraAll(dt) {
    updateCamera(dt);
    const t = clockT;
    if (view) view.update(dt, t, camera, srvT(), coinTaken);
    if (shadowDue()) snapShadow(FX.tmpV.set(P.b.x, P.b.y, P.b.z));
    updateSky(camera.position, t, dt);
    updateAmbient(camera.position, t, AMB);
    setSpeedLines(P.b.vy < -90 ? 0.6 : 0, dt);
}

// ----- play stats: how the game runs on this device and any error it hit -----
const fpsWin = { sum: 0, n: 0 }, errSeen = new Set(), errQueue = [];
let metaFirst = true, loadSecs = 0, lastFps = 60;
function noteError(msg, src, line, col) {
    const file = src ? String(src).split('/').pop().split('?')[0] : '';
    const k = String(msg || '?').slice(0, 150) + (file ? ' @' + file + ':' + (line || 0) + ':' + (col || 0) : '');
    if (errSeen.has(k) || errSeen.size >= 20) return;
    errSeen.add(k); errQueue.push(k);
}
window.addEventListener('error', (e) => noteError(e.message, e.filename, e.lineno, e.colno));
window.addEventListener('unhandledrejection', (e) => noteError('promise: ' + ((e.reason && e.reason.message) || e.reason)));
addEventListener('pagehide', () => { if (running) sendMeta(); });
let gpuNameCache = null;
function gpuName() {
    if (gpuNameCache !== null) return gpuNameCache;
    gpuNameCache = GPU_NAME.slice(0, 90) + (renderer.getContext().getContextAttributes().antialias ? '' : ' (no AA)');
    return gpuNameCache;
}
function sendMeta() {
    const m = { touch: isTouch, fps: fpsWin.n ? Math.round(fpsWin.sum / fpsWin.n) : lastFps, q: getQuality(), errs: errQueue.splice(0, 5) };
    fpsWin.sum = 0; fpsWin.n = 0;
    if (metaFirst) { metaFirst = false; Object.assign(m, { gpu: gpuName(), load: loadSecs, dpr: Math.round(devicePixelRatio * 100) / 100, w: innerWidth, h: innerHeight, cores: navigator.hardwareConcurrency || 0, mem: navigator.deviceMemory || 0 }); }
    net.send('meta', m);
}

// ----- the smoothness watch (every half second): the resolution adapts first, then the quality -----
const fpsWatch = { t: 0, avg: 60, low: 0, good: 0, trial: null, cpuUntil: 0, fails: 0, upAt: -99, upFrom: 1, ceil: 1, ceilUntil: 0, holdUntil: 0, lows: 0 };
function holdFpsWatch(secs) { fpsWatch.holdUntil = fpsWatch.t + (secs || 4); fpsWatch.avg = Math.max(fpsWatch.avg, 58); }
let watchOff = false;
function watchFps(fps) {
    if (!running || document.hidden || watchOff) return;
    const w = fpsWatch;
    w.t += 0.5;
    w.lows = fps < 45 ? w.lows + 1 : 0;
    if (w.lows === 1 && fps < 45) return;
    w.avg += (fps - w.avg) * 0.35;
    if (w.t < 3 || w.t < w.holdUntil) return;
    if (w.t > w.ceilUntil) w.ceil = 1;
    if (w.trial) {
        if (w.t - w.trial.at < 2) return;
        if (w.avg < w.trial.fps * 1.06) { setResScale(w.trial.prev); w.fails++; w.cpuUntil = w.t + Math.min(240, 30 * w.fails); } else w.fails = 0;
        w.trial = null;
        return;
    }
    const scale = getResScale();
    if (w.avg < 54 && w.t > w.cpuUntil && scale > 0.56) {
        if (w.t - w.upAt < 6) { w.ceil = w.upFrom; w.ceilUntil = w.t + 60; }
        w.trial = { at: w.t, fps: w.avg, prev: scale };
        setResScale(scale * 0.85);
        w.good = 0;
        return;
    }
    if (w.avg >= 57) {
        w.good += 0.5;
        if (w.good >= 6 && scale < w.ceil - 0.01) { w.good = 0; w.upAt = w.t; w.upFrom = scale; setResScale(Math.min(w.ceil, scale / 0.88)); }
    } else w.good = 0;
    if (!autoQualityAllowed()) return;
    w.low = w.avg < 45 && (scale <= 0.56 || w.t < w.cpuUntil) ? w.low + 0.5 : 0;
    if (w.low < 3) return;
    w.low = 0;
    const next = { high: 'medium', medium: 'low' }[getQuality()];
    if (!next) return;
    setQuality(next, true, w.t < 45);
    toast('⚙️ Graphics set to ' + (next === 'medium' ? 'Medium' : 'Low') + ' for smoother play', '#7de8ff');
}
// Even frame pacing on fast screens: when most frames miss the refresh and some don't, draw every other refresh instead
const ivs = [];
let refreshMs = 0, paceN = 0, strikes = 0, pacedAt = 0, paced = false, trial = false;
function noteInterval(ms) { if (ms > 2 && ms < 60 && ivs.length < 400) ivs.push(ms); }
let paceOff = false;
function paceFrames() {
    if (!running || document.hidden || isTouch || paceOff) return;
    const now = performance.now();
    if (paced) { if (now - pacedAt > 30000) { paced = false; skipOdd = false; trial = true; ivs.length = 0; } return; }
    if (ivs.length < 200) return;
    paceN++;
    const s = ivs.slice().sort((a, b) => a - b), p10 = s[Math.floor(s.length * 0.1)];
    refreshMs = refreshMs ? Math.min(refreshMs, p10) : p10;
    const late = s.filter((v) => v > refreshMs * 1.5).length / s.length;
    ivs.length = 0;
    const uneven = refreshMs < 9 && late > 0.25 && late < 0.9;
    strikes = uneven ? strikes + 1 : 0;
    if ((trial && uneven) || (paceN > 3 && strikes >= 2 && fpsWatch.t >= fpsWatch.holdUntil)) { paced = true; skipOdd = true; pacedAt = now; strikes = 0; }
    trial = false;
}
const perf = { n: 0, sum: 0, max: 0, last: 0 };
const spikes = [], slowParts = [];
let secAvg = {};
let frameErrors = 0, lastFrame = 0, loadingSignaled = false, fpsAcc = 0, fpsFrames = 0, skipOdd = false, oddFrame = false;
let rafN = 0, offscreen = false;
document.addEventListener('visibilitychange', () => { offscreen = document.hidden; if (running) audioAway(offscreen || connLost || paused); });
function frame(now) {
    requestAnimationFrame(frame);
    rafN++;
    if (skipOdd) { oddFrame = !oddFrame; if (oddFrame) return; }
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    if (lastFrame && !skipOdd) noteInterval(now - lastFrame);
    fpsAcc += (now - (lastFrame || now)) / 1000; fpsFrames++;
    if (fpsAcc >= 0.5) {
        const fps = fpsFrames / fpsAcc;
        lastFps = Math.round(fps);
        if (running && !document.hidden) { fpsWin.sum += fps; fpsWin.n++; }
        if (showFps) $('#fps').textContent = lastFps + ' FPS';
        if (isTouch && !skipOdd && fps > 100) skipOdd = true;
        if (skipOdd && rafN / fpsAcc < 95) { skipOdd = false; paced = false; pacedAt = 0; }
        rafN = 0;
        paceFrames();
        watchFps(fps); fpsAcc = 0; fpsFrames = 0;
    }
    if (lastFrame && now - lastFrame > 45 && spikes.length < 60) spikes.push({ at: Math.round(now), ms: Math.round(now - lastFrame), work: +perf.last.toFixed(1), res: getResScale() });
    lastFrame = now;
    if (!loadingSignaled) { loadingSignaled = true; BX.triggerAllSettings(); }
    pollGamepad();
    padButtons();
    if (running && !paused) {
        const w0 = performance.now();
        try {
            prof.start();
            update(dt);
            prof.mark('update');
            updateCameraAll(dt);
            prof.mark('camera+sky');
            render();
            prof.mark('render');
        } catch (e) {
            if (frameErrors++ < 5) console.error('[frame]', e);
            const at = String((e && e.stack) || '').split('\n').find((l) => /:\d+:\d+/.test(l)) || '';
            noteError('[frame] ' + ((e && e.message) || e), '', 0, 0);
            if (at) noteError('[frame at] ' + at.trim().slice(-120));
        }
        const w = performance.now() - w0;
        perf.n++; perf.sum += w; perf.max = Math.max(perf.max, w); perf.last = w;
        for (let i = 0; i < prof.parts.length; i += 2) secAvg[prof.parts[i]] = (secAvg[prof.parts[i]] || 0) + prof.parts[i + 1];
        secAvg.n = (secAvg.n || 0) + 1;
        if (w > 50 && slowParts.length < 20) { const o = {}; for (let i = 0; i < prof.parts.length; i += 2) o[prof.parts[i]] = +(o[prof.parts[i]] || 0) + +prof.parts[i + 1].toFixed(1); slowParts.push({ at: Math.round(now), ms: Math.round(w), calls: renderer.info.render.calls, prog: renderer.info.programs.length, ...o }); }
    }
}

// =====================================================================================
// Boot: build everything behind the loading screen, join, play (no start menu)
// =====================================================================================
function loadingText(t) { $('#loading').textContent = t; }
let joining = false, joinTask = null, worldReady = null;
async function joinServer() {
    await waitForLogin(400);
    const saved = (storageGet('cs1_name') || '').slice(0, 20);
    for (let attempt = 0; ; attempt++) {
        try { return await connect(BX.identity().loggedIn ? '' : saved); } catch (e) {
            if (attempt >= 4) throw e;
            console.warn('[join] attempt', attempt + 1, 'failed:', e && e.message);
            loadingText('Waking up a server…');
            await sleep(2000 * (attempt + 1));
        }
    }
}
function waitForLogin(ms) {
    if (!BX.bloxity.ready || BX.identity().loggedIn) return Promise.resolve();
    return new Promise((res) => { const t0 = performance.now(); (function check() { if (BX.identity().loggedIn || performance.now() - t0 > ms) res(); else setTimeout(check, 100); })(); });
}
async function play() {
    if (joining || running) return;
    joining = true;
    $('#connectErr').hidden = true; $('#retryBtn').hidden = true;
    if (!joinTask) joinTask = joinServer();
    initAudio();
    try {
        await worldReady;
        loadingText('Joining a server…');
        $('#loadBar').style.width = '92%';
        BX.loadingStep('Joining a server…');
        await joinTask;
        const t0 = performance.now();
        while (!gotProfile && performance.now() - t0 < 6000) await sleep(50);
    } catch (e) {
        joinTask = null;
        console.error(e);
        joining = false;
        loadingText('');
        showConnErr('Could not reach the game server. Check your connection and try again.');
        BX.loadingEnd();
        return;
    }
    joining = false;
    if (connLost) { BX.loadingEnd(); return; }
    running = true;
    S.joinedAt = Date.now();
    if (!me) buildMe();
    const p = net.room.state.players.get(net.room.sessionId);
    if (p) teleport(p.x, p.y, p.z, p.ry); else teleport(SPAWN.x, 0, SPAWN.z, Math.PI);
    if (view) view.setGoal((S.best || 1) + 1);
    loadingText('Almost there…');
    $('#loadBar').style.width = '100%';
    await primeFrames();
    if (connLost) { BX.loadingEnd(); return; }
    // everyone's avatar made behind the loading screen too
    { const t0 = performance.now(); while (avatarsPending() && performance.now() - t0 < 2000) await sleep(30); }
    fpsAcc = 0; fpsFrames = 0;
    allowLiveMusic(getQuality() !== 'low');
    startMusic();
    setMusicMode('plaza'); songName = 'plaza';
    $('#start').hidden = true;
    $('#start').style.opacity = '';
    $('#hud').hidden = false;
    measureHud();
    updateHud();
    showTips();
    BX.adScreen('gameplay');
    BX.gameplayStart();
    if ((S.best || 1) <= 1) setTimeout(() => bigText('CLIMB THE TOWER!', '#ffe24a'), 500);
    else toast('👋 Welcome back, ' + (S.name || 'climber') + '! You\'re on stage ' + (S.cp || 1), '#ffffff');
    setTimeout(() => { if (audioSuspended()) toast('🔊 Tap anywhere for the key sounds!', '#7de8ff'); }, 3500);
    if ((S.best || 1) > 3) setTimeout(offerDaily, 1500); else setTimeout(offerDaily, 90000);
    canvas.focus();
    loadSecs = Math.round(performance.now() / 100) / 10;
    metaT = 8;
    BX.loadingEnd();
    console.info('[Bloxity] environment:', BX.env().env, '· SDK', BX.bloxity.ready ? 'ready' : 'missing');
}
async function primeFrames() {
    $('#start').style.opacity = '0.985';
    $('#hud').hidden = false;
    // the chunks round where you are, all of them, before the loading screen goes
    if (view) view.update(0, 0, camera, srvT(), coinTaken);
    try { await Promise.race([renderer.compileAsync(scene, camera), sleep(1500)]); } catch (e) { /* compiles on first use */ }
    for (let i = 0; i < 4; i++) await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 120); });
    const gl = renderer.getContext();
    if (!gl.fenceSync) return;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const t0 = performance.now();
    while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED && performance.now() - t0 < 1500) await sleep(15);
    gl.deleteSync(sync);
}
function showTips() {
    if (isTouch) return;
    const el = $('#tips');
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    el.innerHTML = k('WASD', 'Move') + k('Space', 'Jump (hold: keep hopping)') + k('Drag', 'Camera') + k('Click', 'Bonk') + k('1-4', 'Tools') + k('[ ]', 'Stages') + k('R', 'Checkpoint') + k('G', 'Shop');
    el.hidden = false; el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 12000);
    setTimeout(() => { el.hidden = true; }, 12900);
}
function unlockAudioOnGesture() {
    const unlock = () => { if (audioSuspended()) resumeAudio(); };
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) addEventListener(ev, unlock, true);
}
function wirePortalSettings() {
    const embedded = (fn) => (v) => { if (BX.isEmbedded()) fn(v); };
    const pct = (v) => { const n = parseFloat(String(v)); if (!isFinite(n)) return undefined; return clamp(n > 1 ? n / 100 : n, 0, 1); };
    BX.listenSetting('master_volume', (v) => { const p = pct(v); if (p !== undefined && BX.isEmbedded()) setVolume('master', p); });
    BX.listenSetting('music_volume', (v) => { const p = pct(v); if (p !== undefined && BX.isEmbedded()) setVolume('music', p); });
    BX.listenSetting('graphics_quality', embedded((v) => { setQuality(v === 'Low' ? 'low' : v === 'Medium' ? 'medium' : v === 'Ultra' || v === 'High' ? 'high' : getQuality(), true); musicLite(v === 'Low'); }));
    BX.listenSetting('camera_sensitivity', (v) => { camSens = clamp(parseFloat(v) || 1, 0.1, 5); });
    BX.listenSetting('show_fps', (v) => { showFps = v === 'true'; $('#fps').hidden = !showFps; });
}
function wirePortalEvents() {
    BX.onPortalEvent((event, data) => {
        if (event === 'respawn_request') { if (running) actions.respawn(); }
        else if (event === 'chat_message_sent' && data && !BX.hasChat()) net.send('chat', { text: String(data) });
        else if (event === 'play_emote' && data) { if (me && me.blox) playEmoteOn(me.blox, String(data)); net.send('emote', { id: String(data) }); }
    });
    BX.onAvatarChanged(() => syncMyAvatar());
    BX.onProportionsChanged(() => syncMyAvatar());
    if (BX.hasChat()) BX.onChat(onBoxityChat);
    // an ad break: everything stops and goes quiet, then carries on
    BX.onAdBreak(() => { paused = true; audioAway(true); for (const k in keys) keys[k] = false; }, () => { paused = false; lastFrame = 0; audioAway(offscreen || connLost); });
}
// The HUD's words and emoji painted for a few frames behind the loading screen, in the fonts and sizes the game uses: the first time
// a glyph (an emoji above all, on Windows) is drawn costs a long pause.
async function warmHudText() {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:3000px;opacity:0.01;pointer-events:none;z-index:1';
    d.innerHTML = ['🛒📋🔁✨📅🌈⚙️🎁💎🥚🧗🪙🏆🥊🚀⏫⏭️☁️🛡️🎡🔥🎯✅⭐👋📶🔊🎟️🔒🦘👟🧲🍀🐾➡️💬🥇🥈🥉✓✕↩️'].map((e) => `<div style="font-size:2rem;white-space:nowrap">${e}</div>`).join('')
        + ['var(--chunky)', 'var(--font)'].map((f) => `<div class="o" style="font-family:${f};font-size:2.4rem;white-space:nowrap">CLACKSTACK STAGE CLEAR! SUMMIT BONK! RAINBOW RUSH x3 COINS SKIPPED Coins 0123456789:.,/ CLIMB THE TOWER</div>`).join('');
    document.body.appendChild(d);
    for (let i = 0; i < 3; i++) await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 150); });
    d.remove();
    // and once in a canvas (name tags, chat bubbles and signs are drawn there)
    const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 140;
    const cx = cv.getContext('2d');
    for (const px of [34, 36, 44, 50, 52, 70]) { cx.font = '700 ' + px + 'px Fredoka, "Arial Rounded MT Bold", sans-serif'; cx.fillText('💬🔒💎 Stage 0123456789 Wins Ground Floor CLACKSTACK', 4, 100); }
}
function startSounds(low) { initAudio(); prerenderMusic(); void low; }
async function prepareWorld() {
    const step = (t, k) => { loadingText(t); BX.loadingStep(t); if (k) $('#loadBar').style.width = Math.round(k * 100) + '%'; };
    step('Loading fonts…', 0.08);
    try { await Promise.race([Promise.all([document.fonts.load('700 40px Fredoka'), document.fonts.load('400 40px "Luckiest Guy"'), document.fonts.load('400 40px "Russo One"')]), sleep(2500)]); } catch (e) { /* fallback font */ }
    await warmHudText();
    step('Stacking the keycaps…', 0.18);
    buildView();
    SH.initShadows();
    await pause();
    step('Tuning the switches…', 0.36);
    await buildAsmr(pause, getQuality() === 'low');
    startSounds(getQuality() === 'low');
    // every HUD screen and panel painted once, invisibly (the browser compiles how to draw them now)
    step('Waking up the Pals…', 0.55);
    for (const id of ['clicky', 'mochi', 'bun', 'pip']) buddyIcon(id);
    {
        const hud = $('#hud');
        hud.hidden = false; hud.classList.add('warmui');
        measureHud();
        const endPanels = warmPanels();
        for (let i = 0; i < 4; i++) await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 120); });
        endPanels();
        hud.classList.remove('warmui'); hud.hidden = true;
    }
    // the warm-up: every shader the game uses (the keys, the pals, every effect) compiled and drawn once now, not in play
    step('Polishing the tower…', 0.75);
    const extras = [fxWarmGroup(), keyWarmGroup()];
    for (const g of extras) { g.position.set(0, -60, 0); scene.add(g); }
    buddiesWarm();
    try {
        const base = await Promise.race([loadBase(), sleep(4000)]);
        const a = base ? await createAvatar(null) : null;
        if (a) { a.root.position.set(0, -60, 10); a.update(1 / 60, { t: 0 }); scene.add(a.root); extras.push(a.root); }
    } catch (e) { /* the avatar's shaders compile when it first shows */ }
    fxShowAll(true);
    camera.position.set(-72, 40, 200); camera.lookAt(0, 30, 0); camera.updateMatrixWorld();
    gpuName();
    try { await Promise.race([renderer.compileAsync(scene, camera), sleep(1500)]); } catch (e) { /* later */ }
    const culled = [];
    scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isSprite || o.isLine) && o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
    render();
    for (const o of culled) o.frustumCulled = true;
    await pause();
    fxShowAll(false);
    for (const g of extras) scene.remove(g);
    beginBuddies(); endBuddies();
    setMood('dusk', true);
    console.info('[prewarm] ready,', renderer.info.programs.length, 'shaders');
}
async function boot() {
    installIcons();
    BX.initBloxity();
    joinTask = joinServer();
    joinTask.catch(() => {});
    loadBase().catch(() => {});
    // the emote catalogue, once at startup (from the environment Boxity told the page)
    BX.loadEmotes().catch(() => {});
    worldReady = prepareWorld();
    wirePortalSettings();
    wirePortalEvents();
    // ONE identity listener (bloxity.js holds the only onUserChanged subscription): a sign-in mid-game is verified on this same
    // connection (the server swaps in the account's progress), so nobody is pulled out of their room
    BX.onIdentity((id) => {
        if (net.room && id.loggedIn && id.token && !net.bloxity) net.send('auth', { token: id.token });
        if (net.room) { setupLocalAvatar(); syncMyAvatar(); }
    });
    BX.onEnvironmentChanged(() => console.info('[Bloxity] environment:', BX.env().env));
    addEventListener('pagehide', () => { leaving = true; try { if (net.room) net.room.leave(true); } catch (e) { /* closing anyway */ } });
    $('#retryBtn').addEventListener('click', () => location.reload());
    unlockAudioOnGesture();
    requestAnimationFrame(frame);
    play();
}
boot();

// =====================================================================================
// QA: the autopilot: climb the path of your checkpoint's stage, key by key (hop when the next is higher or across a gap), bounce up
// cliffs, wait for blinking keys; off the tower: walk to the first landing
// =====================================================================================
// the autopilot speaks in world directions; the camera turns them, so undo that
function mapInput(o) {
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    const f = o.mx * fx + o.mz * fz, r = o.mx * rx + o.mz * rz;
    return { mx: fx * f + rx * r, mz: fz * f + rz * r, jump: o.jump, hold: o.hold };
}
function climbPilot() {
    let tgtI = 0, stuckT = 0, lastD = 1e9, stage = 0, route = null;
    return (dt) => {
        const b = P.b, out = { mx: 0, mz: 0, jump: false, hold: false };
        if (!view || switching) return out;
        const n = S.cp || 1;
        if (n !== stage || !route) { stage = n; route = []; tgtI = 0; const st = buildStage(n), a = landingAt(n); route.push({ x: a.x, y: a.y, z: a.z }); for (const k of st.pathKey) { if (!k) continue; const w = toWorld(n, k.u, k.slide ? slideV(k.slide, srvT()) : k.v); route.push({ x: w.x, y: k.top, z: w.z, k }); } const e = landingAt(n + 1); route.push({ x: e.x, y: e.y, z: e.z }); }
        // on the plaza: to the first landing
        if (b.y < 0.6 && n === 1) { const a = landingAt(1); const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz); out.mx = dx / d; out.mz = dz / d; if (d < 16) out.jump = out.hold = true; cam.yaw = Math.atan2(-out.mx, -out.mz); return mapInput(out); }
        // the nearest node ahead of you
        while (tgtI < route.length - 1 && Math.hypot(route[tgtI].x - b.x, route[tgtI].z - b.z) < 2.2 && Math.abs(route[tgtI].y - b.y) < 2) tgtI++;
        const tg = route[Math.min(tgtI, route.length - 1)];
        let tx = tg.x, tz = tg.z;
        if (tg.k && tg.k.slide) { const w = toWorld(n, tg.k.u, slideV(tg.k.slide, srvT())); tx = w.x; tz = w.z; }
        const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
        if (d > 0.4) { out.mx = dx / d; out.mz = dz / d; }
        const rise = tg.y - b.y;
        // a blinking key ahead that's gone (or about to go): wait for it, unless the key you're on is going first
        if (tg.k && tg.k.blink && b.onGround) {
            const gk = b.ground && b.ground.k, mine = gk && gk.blink ? blinkLeft(gk.blink, srvT()) : 9;
            if (blinkLeft(tg.k.blink, srvT() + 0.35) < 0.5 && mine > 0.45) { out.mx = 0; out.mz = 0; cam.yaw = Math.atan2(-dx, -dz); return mapInput(out); }
        }
        if (b.onGround && (rise > 1.0 || d > 5.2)) { out.jump = true; out.hold = true; }
        if (!b.onGround) out.hold = true;
        // stuck: back off a step to the node before
        if (d > lastD - 0.02 && b.onGround) stuckT += dt; else stuckT = 0;
        lastD = d;
        if (stuckT > 2.5) { stuckT = 0; tgtI = Math.max(0, tgtI - 1); }
        cam.yaw = Math.atan2(-(out.mx || 0.001), -(out.mz || 0.001));
        return mapInput(out);
    };
}
if (import.meta.env.DEV || import.meta.env.VITE_QA) {
    window.__qa = {
        P, S, cam, net, scene, camera, renderer: () => renderer, audio: () => audioDebug(), actions, view: () => view,
        state: () => ({ x: +P.b.x.toFixed(2), y: +P.b.y.toFixed(2), z: +P.b.z.toFixed(2), onGround: P.b.onGround, coins: S.coins, gems: S.gems, wins: S.wins, best: S.best, top: S.top, cp: S.cp, pickups: S.pickups, snaps: P.snaps, programs: renderer.info.programs.length, prompt: activePrompt && activePrompt.label(), q: getQuality(), others: remotes.size, qi: S.qi, stage: stageAtY(Math.max(1, P.b.y)), chunks: view ? view.chunks.size : 0 }),
        auto: (on) => { P.auto = on === false ? null : climbPilot(); },
        key: (code, down) => { keys[code] = !!down; if (down && code === 'Space') P.jumpPress = clockT; },
        jump: () => { P.jumpPress = clockT; },
        tool: (id) => actions.tool(id),
        teleport: (x, y, z, yaw) => { net.send('qa', { tp: [x, y, z] }); teleport(x, y, z, yaw); },
        toLanding: (n) => { const r = respawnAt(n); net.send('qa', { tp: [r.x, r.y, r.z] }); teleport(r.x, r.y, r.z, r.ry); },
        cam: () => ({ yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist }),
        // materials drawn on objects of different kinds (instanced / batched / skinned / with instance colours): three.js works out
        // their shader again at every switch, every frame
        mats: () => {
            const by = new Map();
            scene.traverse((o) => {
                if (!o.isMesh && !o.isPoints && !o.isLine) return;
                for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
                    const sig = (o.isInstancedMesh ? 'I' + (o.instanceColor ? 'c' : '') : '') + (o.isBatchedMesh ? 'B' + (o._colorsTexture ? 'c' : '') : '') + (o.isSkinnedMesh ? 'S' : '') + (o.geometry && o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length ? 'M' : '') + (o.geometry && o.geometry.attributes.color && o.geometry.attributes.color.itemSize === 4 ? 'A' : '') + (o.geometry && o.geometry.attributes.tangent ? 'T' : '') || 'plain';
                    let e = by.get(m); if (!e) { e = { name: m.type + ':' + (m.customProgramCacheKey ? m.customProgramCacheKey() : ''), sigs: new Map() }; by.set(m, e); }
                    e.sigs.set(sig, (e.sigs.get(sig) || 0) + 1);
                }
            });
            return [...by.values()].filter((e) => e.sigs.size > 1).map((e) => e.name + ' ' + JSON.stringify(Object.fromEntries(e.sigs)));
        },
        // which materials three.js works out a shader for (it asks their customProgramCacheKey each time): counted over the next secs
        progCalls: async (secs) => {
            const counts = new Map(), wrapped = [];
            scene.traverse((o) => {
                for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
                    if (m.userData.__pc) continue;
                    const f = m.customProgramCacheKey, name = m.type + ':' + f.call(m).slice(0, 24) + ':' + (o.name || o.type) + ' ' + m.uuid.slice(0, 5) + (m.map ? ' map' : '') + (m.alphaMap ? ' alpha' : '') + (m.transparent ? ' tr' : '') + ' side' + m.side + ' fog' + m.fog + ' geo:' + Object.keys(o.geometry ? o.geometry.attributes : {}).join(',') + ' vc' + m.vertexColors + ' ver' + m.version;
                    m.userData.__pc = true; wrapped.push([m, f]);
                    m.customProgramCacheKey = function () { counts.set(name, (counts.get(name) || 0) + 1); return f.call(this); };
                }
            });
            const f0 = perf.n;
            await new Promise((r) => setTimeout(r, (secs || 3) * 1000));
            for (const [m, f] of wrapped) { m.customProgramCacheKey = f; delete m.userData.__pc; }
            const frames = Math.max(1, perf.n - f0);
            return { frames, perFrame: [...counts.entries()].map(([k, v]) => [k, +(v / frames).toFixed(2)]).sort((a, b) => b[1] - a[1]).slice(0, 12) };
        },
        look: (yaw, pitch, dist) => { cam.yaw = yaw; cam.pitch = pitch; if (dist !== undefined) cam.dist = dist; },
        quality: (q) => setQuality(q),
        give: (o) => net.send('qa', o),
        send: (type, m) => net.send(type, m || {}),
        panel: (k, tab) => openPanel(k, tab),
        close: () => { let n = 0; while (closeTop() && n < 9) n++; return n; },
        perf: (reset) => { const r = { frames: perf.n, avgMs: +(perf.sum / Math.max(1, perf.n)).toFixed(2), maxMs: +perf.max.toFixed(1), fps: lastFps, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, paced: skipOdd }; if (reset) { perf.n = 0; perf.sum = 0; perf.max = 0; } return r; },
        diag: () => { renderer.info.reset(); renderer.info.autoReset = false; render(); const r = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, ratio: renderer.getPixelRatio(), programs: renderer.info.programs.length }; renderer.info.autoReset = true; return r; },
        errors: () => [...errSeen],
        noWatch: (on) => { watchOff = on === undefined ? true : !!on; },
        noPace: () => { paceOff = true; skipOdd = false; paced = false; },
        hud: (on) => { $('#hud').style.display = on ? '' : 'none'; $('#touch').style.display = on ? '' : 'none'; },
        mood: (m) => setMood(m, true),
        res: (k) => setResScale(k),
        gpu: () => gpuName(),
        spikes: () => spikes.splice(0),
        slow: () => slowParts.splice(0),
        sections: () => { const n = secAvg.n || 1, o = {}; for (const k in secAvg) if (k !== 'n') o[k] = +(secAvg[k] / n).toFixed(2); secAvg = {}; return o; },
        avatars: () => avatarsPending(),
        hatch: (c, n) => net.send('box', { id: c, n: n || 1 }),
        hatchAuto: (on) => { hatchAuto = !!on; },
        remotes: () => remotes,
        holdWatch: (s) => holdFpsWatch(s),
    };
}
void QUESTS; void panelIs; void LEADERBOARDS; void fadeIn; void holdFpsWatch; void lowQ; void HUB; void stageCoins; void yawOf; void RISE; void isSummit; void fmtComma; void summitAt;
