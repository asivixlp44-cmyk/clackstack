import { Room } from 'colyseus';
import { GameState, PlayerState } from './schema.js';
import {
    getProfile, hasProfile, markDirty, saveProfiles, adoptGuestProgress, loadProfile, releaseProfile, topProfiles, recordSession, saveSoon, USE_DB,
} from './profiles.js';
import { sealProfile, openSave } from './saves.js';
import { verifyBloxityToken, verifyAdReward, queueScore } from './bloxity.js';
import {
    CFG, coinMult, stageCoins, AGAIN_K, pickupCoins, SUMMIT_GEMS, walkOf, reachOf, luckOf, LUCK_MULT, teamSize, hasItem, skipGems, isSummit,
    UPGRADES, upgradeById, upgradeCost, ITEMS, itemById, TRAILS, trailById, restackNeed, restackGems, BUDDIES, buddyById, BOXES, boxById, INDEX_GEMS,
    titleOf, SPIN, TASKS, tasksFor, dayKey, QUESTS, DAILY, dailyStatus, GIFTS, CODES, PACKS, rewardFor, rewardText, clamp, BOT_NAMES,
} from '../../shared/config.js';
import { SPAWN, HUB, HUB_R, landingTop, onLanding, respawnAt, coinAt, buildStage, routeOf, maxYFor, landingBox } from '../../shared/world.js';
import { moveBudget } from '../../shared/physics.js';

const GREEN = '#7dff6b', GOLD = '#ffd028', RED = '#ff9a8a';
const cleanName = (name) => String(name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20);
const randomName = () => 'Climber' + Math.floor(1000 + Math.random() * 9000);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v, d) => (finite(v) ? v : d);
const rnd = (a, b) => a + Math.random() * (b - a);
// Guest ids come from the browser; they can never claim a Bloxity identity
const guestUid = (uid, fallback) => String(uid || fallback).replace(/^legion_/, 'guest_').slice(0, 64);
const cleanAvatar = (av) => (typeof av === 'string' && av.length <= 2000 ? av : '');
const secsNow = (ms) => (ms % 1e9) / 1000;
// on any landing (a safe spot: nobody can bonk you there)
function onAnyLanding(x, y, z) {
    const n = Math.max(1, Math.round((y - 1) / 30) + 1);
    for (const k of [n - 1, n, n + 1]) if (k >= 1 && onLanding(k, x, y, z, 1)) return k;
    return 0;
}

export const liveRooms = new Set();

// The tower: up to 16 climbers on the same Stack (a few bots keep it lively when it's quiet). Moving is on each player's own screen;
// every landing, every coin, every bonk and everything that earns or costs anything is checked and counted here.
export class TowerRoom extends Room {
    maxClients = CFG.maxPlayers;
    maxMessagesPerSecond = 120;

    onCreate() {
        liveRooms.add(this);
        this.setState(new GameState());
        this.setPatchRate(50);
        this.sessions = new Map();
        this.bots = [];
        this.rushAt = Date.now() + rnd(90, 150) * 1000;   // the first RAINBOW RUSH comes sooner
        const on = (type, fn) => this.onMessage(type, (client, m) => { try { fn.call(this, client, m || {}); } catch (e) { console.warn('[msg]', type, e.message); } });
        on('ping', (client, m) => client.send('pong', { c: num(m.c, 0), s: Date.now() }));
        on('move', this.onMove);
        on('cp', this.onCheckpoint);
        on('coin', this.onCoin);
        on('bounce', this.onBounce);
        on('slap', this.onSlap);
        on('goto', this.onGoto);
        on('respawn', this.onRespawn);
        on('skip', this.onSkip);
        on('adskip', this.onAdSkip);
        on('upgrade', this.onUpgrade);
        on('item', this.onItem);
        on('trail', this.onTrail);
        on('box', this.onBox);
        on('equip', this.onEquip);
        on('equipbest', this.onEquipBest);
        on('restack', this.onRestack);
        on('spin', this.onSpin);
        on('pack', this.onPack);
        on('x2', this.onX2);
        on('adx2', this.onAdX2);
        on('qclaim', this.onQuestClaim);
        on('tclaim', this.onTaskClaim);
        on('daily', this.onDaily);
        on('gift', this.onGift);
        on('code', this.onCode);
        on('tut', this.onTut);
        on('meta', this.onMeta);
        on('want', (client) => { const s = this.sessions.get(client.sessionId), now = Date.now(); if (s && now - (s.wantAt || 0) > 1000) { s.wantAt = now; this.sendProfile(s); } });
        on('auth', this.onBloxityLogin);
        on('avatar', this.onAvatar);
        on('emote', this.onEmote);
        on('chat', this.onChat);
        // QA only (QA=1, never on Legion): give yourself Coins, Gems, stages...
        if (process.env.QA === '1' && !process.env.BLOXITY_GAME_ID) on('qa', this.onQa);
        this.lastTick = Date.now();
        this.secAcc = 0;
        this.setSimulationInterval(() => this.update(), 50);
        this.clock.setInterval(() => this.broadcastBoards(), 10000);
        this.fillBots();
    }

    async onAuth(client, options) {
        const legion = options && options.token ? await verifyBloxityToken(options.token) : null;
        return legion ? { legion } : { guest: true };
    }

    async onJoin(client, options, auth) {
        options = options || {};
        const guest = guestUid(options.uid, client.sessionId);
        let uid = guest, name = cleanName(options.name);
        if (auth && auth.legion) {
            uid = 'legion_' + auth.legion.id;
            name = cleanName(auth.legion.name) || name;
            await adoptGuestProgress(uid, guest, name, auth.legion.carriedFrom);
        }
        await loadProfile(uid);
        if (uid !== guest && !isOnline(guest)) releaseProfile(guest, isOnline);
        // A fresh server on a temporary disk restores the browser's signed backup (never with a database)
        const restore = !USE_DB && !hasProfile(uid) && openSave(options.save, [uid, guest]);
        const profile = getProfile(uid, name, randomName());
        if (restore) { Object.assign(profile, restore); markDirty(); }
        this.fixProfile(profile);
        kickOthers(uid, null);
        const player = new PlayerState();
        player.name = profile.name;
        player.pid = this.freePid();
        player.av = cleanAvatar(options.av);
        player.bx = auth && auth.legion ? auth.legion.id : '';
        const now = Date.now();
        // back where you were climbing (your checkpoint), or on the plaza the first time
        const at = profile.cp > 1 ? respawnAt(profile.cp, player.pid) : { x: SPAWN.x + rnd(-6, 6), y: 0, z: SPAWN.z + rnd(-3, 3), ry: Math.PI };
        Object.assign(player, { x: at.x, y: at.y, z: at.z, ry: at.ry, t: now });
        this.state.players.set(client.sessionId, player);
        const s = {
            id: client.sessionId, client, profile, player, guest, joinedAt: now, lastChat: 0, playSecs: 0, dirtyAt: 0, sealAt: 0, minAcc: 0,
            gifts: {}, last: { x: at.x, y: at.y, z: at.z }, lastAt: now, snapAt: 0, homeAt: 0, spinSecs: 0, warpAt: 0, slapAt: 0, againAt: {},
            coinT: new Map(), bounceAt: 0, lbCoins: 0, skipAsking: false,
            stats: {
                fresh: now - (profile.firstPlay || 0) < 60000, landings: 0, coins: 0, pickups: 0, summits: 0, bonks: 0, falls: 0, skips: 0, caps: 0, ups: 0, buys: 0,
                restacks: 0, top0: profile.top, touch: false, fps: 0, fpsSum: 0, fpsN: 0, fpsMin: 0, q: '', gpu: '', load: 0, dev: null, errs: [], firstLandAt: 0,
            },
        };
        this.sessions.set(client.sessionId, s);
        this.syncPublic(s);
        client.send('hello', { now, bloxity: uid.startsWith('legion_') });
        profile.lastSeen = now;
        this.sendProfile(s, true);
        this.broadcastBoards(client);
        this.fillBots();
    }
    freePid() {
        const used = new Set([...this.state.players.values()].map((p) => p.pid));
        for (let i = 1; i < 255; i++) if (!used.has(i)) return i;
        return 255;
    }
    // Older saves / hand-edited data: keep every field the right shape
    fixProfile(p) {
        for (const k of ['coins', 'gems', 'wins', 'restacks', 'totalCoins', 'pickups', 'summits', 'bounces', 'bonks', 'caps', 'upgrades', 'spins', 'spinsUsed', 'x2Until', 'qi', 'tut', 'playtime', 'lastSeen']) if (!finite(p[k]) || p[k] < 0) p[k] = 0;
        p.gems = Math.floor(p.gems);
        p.qi = clamp(Math.floor(p.qi), 0, QUESTS.length);
        p.best = clamp(Math.floor(num(p.best, 1)), 1, 1e5);
        p.top = clamp(Math.max(Math.floor(num(p.top, 1)), p.best), 1, 1e5);
        p.cp = clamp(Math.floor(num(p.cp, 1)), 1, p.best);
        for (const k of ['daily', 'codes', 'seen', 'jq', 'ups', 'buds', 'index', 'items', 'trails']) p[k] = obj(p[k]);
        for (const id of Object.keys(p.ups)) { const u = upgradeById[id]; if (!u) delete p.ups[id]; else p.ups[id] = clamp(num(p.ups[id], 0) | 0, 0, u.max); }
        for (const id of Object.keys(p.items)) if (!itemById[id]) delete p.items[id];
        p.items.glove = 1;
        for (const id of Object.keys(p.trails)) if (!trailById[id] || !id) delete p.trails[id];
        if (typeof p.trail !== 'string' || (p.trail && !p.trails[p.trail])) p.trail = '';
        for (const id of Object.keys(p.buds)) if (!buddyById[id] || !(p.buds[id] > 0)) delete p.buds[id];
        p.team = arr(p.team).filter((id) => buddyById[id] && p.buds[id] > 0).slice(0, teamSize(p));
        p.jq = { day: String(p.jq.day || ''), list: arr(p.jq.list).slice(0, 3).map((q) => ({ k: String(q.k), p: Math.max(0, num(q.p, 0)), c: !!q.c })).filter((q) => TASKS[q.k]) };
        if (!finite(p.firstPlay)) p.firstPlay = Date.now();
    }

    // A dropped connection has 30 seconds to come back
    onDrop(client) {
        const r = this.allowReconnection(client, 30), s = this.sessions.get(client.sessionId);
        r.catch(() => {});
        if (s) { s.recon = r; s.dropAt = Date.now(); }
    }
    onReconnect(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        s.client = client; s.recon = null;
        kickOthers(s.profile.uid, s);
        this.syncPublic(s);
        client.send('hello', { now: Date.now(), bloxity: s.profile.uid.startsWith('legion_') });
        this.sendProfile(s, true);
        this.broadcastBoards(client);
    }
    onLeave(client) {
        const s = this.sessions.get(client.sessionId);
        this.state.players.delete(client.sessionId);
        this.sessions.delete(client.sessionId);
        markDirty();
        this.fillBots();
        if (!s) return;
        const p = s.profile, st = s.stats;
        p.lastSeen = Date.now();
        this.flushBoards(s);
        recordSession({
            at: new Date(), secs: Math.round((Date.now() - s.joinedAt) / 1000), fresh: st.fresh, touch: st.touch,
            fps: st.fpsN ? Math.round(st.fpsSum / st.fpsN) : st.fps, fpsMin: st.fpsMin, q: st.q, gpu: st.gpu, load: st.load, dev: st.dev, errs: st.errs,
            landings: st.landings, coins: Math.round(st.coins), pickups: st.pickups, summits: st.summits, bonks: st.bonks, falls: st.falls, skips: st.skips,
            caps: st.caps, ups: st.ups, buys: st.buys, restacks: st.restacks, top0: st.top0, top: p.top, best: p.best, squad: this.sessions.size + 1,
            firstLand: st.firstLandAt ? Math.round((st.firstLandAt - s.joinedAt) / 1000) : -1, qi: p.qi,
        }).catch((e) => console.warn('[stats]', e.message));
        if (!isOnline(p.uid)) releaseProfile(p.uid, isOnline);
    }
    onDispose() {
        liveRooms.delete(this);
        for (const s of this.sessions.values()) { s.profile.lastSeen = Date.now(); this.flushBoards(s); }
        markDirty();
        return saveProfiles();
    }

    // ----- helpers -----
    sendTo(s, type, msg) { try { if (s) s.client.send(type, msg); } catch (e) { /* gone */ } }
    syncPublic(s) {
        const p = s.profile, pl = s.player;
        pl.name = p.name; pl.top = Math.min(65535, p.top); pl.cp = Math.min(65535, p.cp); pl.wins = p.wins; pl.title = titleOf(p.top);
        const team = p.team.join(',');
        if (pl.team !== team) pl.team = team;
        if (pl.trail !== p.trail) pl.trail = p.trail;
    }
    x2On(p, now) { return (p.x2Until || 0) > (now || Date.now()); }
    rushOn(now) { return this.state.rush > (now || Date.now()); }
    // The player's private progress: straight away for anything they clicked on; while climbing a few times a second (lite)
    sendProfile(s, seal) {
        const p = s.profile, now = Date.now();
        s.dirtyAt = 0;
        this.jqOf(p, now);
        this.checkQuests(s);
        const m = {
            coins: Math.floor(p.coins), gems: p.gems, wins: p.wins, best: p.best, top: p.top, cp: p.cp, restacks: p.restacks, totalCoins: Math.floor(p.totalCoins),
            pickups: p.pickups, summits: p.summits, bounces: p.bounces, bonks: p.bonks, caps: p.caps,
            ups: p.ups, upgrades: p.upgrades, items: p.items, trail: p.trail, trails: p.trails, buds: p.buds, team: p.team, index: p.index,
            spins: p.spins, spinIn: Math.max(0, CFG.spinMins * 60 - s.spinSecs), spinsUsed: p.spinsUsed, x2Until: p.x2Until,
            qi: p.qi, qv: p.qi < QUESTS.length ? this.questValue(p, QUESTS[p.qi].kind) : 0, jq: p.jq, daily: p.daily, codes: p.codes,
            gifts: s.gifts, sessionSecs: s.playSecs, playtime: p.playtime, tut: p.tut, seen: p.seen, firstPlay: p.firstPlay, now,
        };
        if (!USE_DB && (seal || now - s.sealAt > 10000)) { s.sealAt = now; m.save = sealProfile(p); }
        this.sendTo(s, 'profile', m);
    }
    sendLite(s) {
        const p = s.profile;
        s.dirtyAt = 0;
        this.checkQuests(s);
        const m = { coins: Math.floor(p.coins), wins: p.wins, best: p.best, top: p.top, cp: p.cp, pickups: p.pickups, summits: p.summits, totalCoins: Math.floor(p.totalCoins), bounces: p.bounces, bonks: p.bonks };
        if (p.qi < QUESTS.length) m.qv = this.questValue(p, QUESTS[p.qi].kind);
        this.sendTo(s, 'lite', m);
    }
    dirty(s) { if (!s.dirtyAt) s.dirtyAt = Date.now(); markDirty(); }
    changed(s) { this.syncPublic(s); this.sendProfile(s); saveSoon(); }
    toast(s, text, color) { this.sendTo(s, 'toast', { text, color: color || '#ffffff' }); }
    broke(s, need, name, cur) { this.sendTo(s, 'broke', { need: Math.ceil(need), name, cur }); }
    payCoins(s, n, name) { const p = s.profile; if (p.coins < n) { this.broke(s, n - p.coins, name, 'coins'); return false; } p.coins -= n; s.stats.buys++; return true; }
    payGems(s, n, name) { const p = s.profile; if (p.gems < n) { this.broke(s, n - p.gems, name, 'gems'); return false; } p.gems -= n; s.stats.buys++; return true; }
    addCoins(s, n) { const p = s.profile; n = Math.max(0, Math.round(n)); p.coins += n; p.totalCoins += n; s.stats.coins += n; s.lbCoins += n; return n; }
    giveReward(s, r, why) {
        const p = s.profile, got = rewardFor(p, r);
        if (got.coins) this.addCoins(s, got.coins);
        if (got.gems) p.gems += got.gems;
        if (got.spins) p.spins += got.spins;
        if (got.x2) p.x2Until = Math.max(Date.now(), p.x2Until || 0) + got.x2 * 60000;
        if (why) this.sendTo(s, 'reward', { text: rewardText(got), why, gems: got.gems || 0 });
        return got;
    }
    // what's been earned toward the boards since the last report
    flushBoards(s) {
        const p = s.profile;
        if (s.lbCoins > 0) { queueScore(p.uid, 'coins', s.lbCoins); s.lbCoins = 0; }
    }
    // send a player to a spot (a landing, the plaza): the moves still on their way from where they were are dropped until they arrive
    sendHome(s, at, why) {
        s.last = { x: at.x, y: at.y, z: at.z }; s.homeAt = Date.now(); s.lastAt = Date.now(); s.moveB = undefined; s.riseB = undefined;
        this.sendTo(s, 'warped', { x: at.x, y: at.y, z: at.z, ry: at.ry ?? 0, why: why || '' });
    }

    // ----- daily tasks, quests -----
    jqOf(p, now) {
        const d = dayKey(now);
        if (p.jq.day !== d) p.jq = { day: d, list: tasksFor(d).map((k) => ({ k, p: 0, c: false })) };
        return p.jq;
    }
    task(s, k, n) {
        const jq = this.jqOf(s.profile, Date.now());
        for (const q of jq.list) {
            if (q.k !== k || q.c) continue;
            const was = q.p;
            q.p = Math.min(TASKS[k].n, q.p + n);
            if (was < TASKS[k].n && q.p >= TASKS[k].n) { this.sendTo(s, 'taskdone', { k }); s.jqDirty = true; }
        }
        this.dirty(s);
    }
    questValue(p, kind) {
        if (kind === 'double' || kind === 'carpet' || kind === 'hop') return hasItem(p, kind) ? 1 : 0;
        return Math.floor(p[kind] || 0);
    }
    checkQuests(s) {
        const p = s.profile;
        if (p.qi >= QUESTS.length) return;
        const Q = QUESTS[p.qi];
        if (this.questValue(p, Q.kind) >= Q.n && s.questAnnounced !== p.qi) { s.questAnnounced = p.qi; this.sendTo(s, 'questdone', { qi: p.qi }); }
    }
    onQuestClaim(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        if (p.qi >= QUESTS.length) return;
        const Q = QUESTS[p.qi];
        if (this.questValue(p, Q.kind) < Q.n) return;
        p.qi++;
        this.giveReward(s, Q, 'Quest complete!');
        this.changed(s);
    }
    onTaskClaim(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const q = this.jqOf(s.profile, Date.now()).list[m.i | 0];
        if (!q || q.c || q.p < TASKS[q.k].n) return;
        q.c = true;
        this.giveReward(s, TASKS[q.k], 'Daily task done!');
        this.changed(s);
    }

    // ----- 20 times a second: the bots; every second: playtime, free spins, gifts -----
    update() {
        const now = Date.now(), dt = Math.min(0.1, (now - this.lastTick) / 1000);
        this.lastTick = now;
        this.state.now = now;
        for (const b of this.bots) this.driveBot(b, now, dt);
        this.updateRush(now);
        this.secAcc += dt;
        if (this.secAcc >= 1) { this.secAcc -= 1; this.tick(now); }
        for (const s of this.sessions.values()) if (s.dirtyAt && now - s.dirtyAt > 250) { this.syncPublic(s); if (s.jqDirty) { s.jqDirty = false; this.sendProfile(s); } else this.sendLite(s); }
    }
    tick(now) {
        for (const s of this.sessions.values()) {
            const p = s.profile;
            p.playtime = (p.playtime || 0) + 1;
            p.lastSeen = now;
            s.playSecs++;
            s.minAcc++;
            if (s.minAcc >= 60) { s.minAcc = 0; queueScore(p.uid, 'playtime', 1); }
            if (s.playSecs % 10 === 0) this.flushBoards(s);
            if (p.spins < CFG.spinMax) { s.spinSecs++; if (s.spinSecs >= CFG.spinMins * 60) { s.spinSecs = 0; p.spins++; this.toast(s, '🎡 A free spin is ready!', GOLD); this.changed(s); } } else s.spinSecs = 0;
            const g = GIFTS.findIndex((x, i) => !s.gifts[i] && s.playSecs >= x.min * 60 && s.playSecs < x.min * 60 + 1);
            if (g >= 0) this.toast(s, '🎁 A FREE gift is ready!', GOLD);
        }
        markDirty();
    }
    // RAINBOW RUSH: every few minutes while someone real is here, every coin x3 for a while (the keys flash the rainbow for everyone)
    updateRush(now) {
        if (this.state.rush && now > this.state.rush) this.state.rush = 0;
        if (this.state.rush || now < this.rushAt) return;
        this.rushAt = now + (CFG.rushSecs + rnd(CFG.rushEvery[0], CFG.rushEvery[1])) * 1000;
        if (!this.sessions.size) return;
        this.state.rush = now + CFG.rushSecs * 1000;
        this.broadcast('rush', { until: this.state.rush });
    }

    // ----- moving -----
    // where a player says they are: checked against how far they could have moved, how fast they could have risen and how high they
    // can be (the landing after their best, a flight and a big jump higher)
    onMove(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !finite(m.x) || !finite(m.y) || !finite(m.z)) return;
        const now = Date.now(), p = s.profile, L = s.last;
        const dt = (now - s.lastAt) / 1000;
        s.lastAt = now;
        // just sent somewhere (a landing, the plaza): the moves still on their way from where they were are dropped (no snap) until
        // they arrive
        if (s.homeAt) {
            if (now - s.homeAt < 30000 && Math.hypot(m.x - L.x, m.z - L.z) + Math.abs(m.y - L.y) * 0.5 > 8) return;
            s.homeAt = 0;
        }
        const rise = m.y - L.y;
        s.riseB = Math.min((s.riseB ?? 40) + Math.max(0, dt) * 100, 60);
        const riseOk = rise <= 0 || rise <= s.riseB;
        if (riseOk && rise > 0) s.riseB -= rise;
        const bad = !moveBudget(s, Math.hypot(m.x - L.x, m.z - L.z), walkOf(p) * 1.25 + 8, dt) || !riseOk || m.y > maxYFor(p.best) || m.y < -30 || Math.hypot(m.x, m.z) > HUB_R + 40;
        if (bad) {
            if (now - s.snapAt > 300) { s.snapAt = now; this.sendTo(s, 'snap', { x: L.x, y: L.y, z: L.z }); }
            return;
        }
        L.x = m.x; L.y = m.y; L.z = m.z;
        const pl = s.player;
        pl.x = m.x; pl.y = m.y; pl.z = m.z; pl.ry = finite(m.ry) ? m.ry : 0; pl.anim = finite(m.a) ? clamp(m.a | 0, 0, 3) : 0;
        pl.t = finite(m.ts) ? clamp(m.ts, now - 1500, now + 50) : now;
    }
    // a landing reached: a new one (the one after your best) pays Coins, every tenth stage a Summit (a Win, Gems); one you'd reached
    // before is your checkpoint again (and pays a little when you've climbed up to it)
    onCheckpoint(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const n = m.n | 0, p = s.profile, L = s.last, now = Date.now();
        if (n < 1 || n > p.best + 1) return;
        if (!onLanding(n, L.x, L.y, L.z, 3)) return;
        if (n === p.best + 1) this.reachLanding(s, n, false);
        else if (n !== p.cp) {
            const climbed = n === p.cp + 1;
            p.cp = n;
            if (climbed && now - (s.againAt[n] || 0) > 60000) {
                s.againAt[n] = now;
                const got = this.addCoins(s, stageCoins(n) * AGAIN_K * coinMult(p, this.x2On(p, now), this.rushOn(now)));
                this.sendTo(s, 'landed', { n, got, again: true });
            }
            this.dirty(s);
        }
    }
    reachLanding(s, n, skipped) {
        const p = s.profile, now = Date.now();
        p.best = n; p.cp = n;
        s.stats.landings++;
        if (!s.stats.firstLandAt) s.stats.firstLandAt = now;
        if (n > p.top) { p.top = n; queueScore(p.uid, 'stage', n); }
        let got = 0, win = false, gems = 0;
        if (!skipped) got = this.addCoins(s, stageCoins(n) * coinMult(p, this.x2On(p, now), this.rushOn(now)));
        this.task(s, 'climb', 1);
        if (isSummit(n)) {
            win = true; gems = SUMMIT_GEMS;
            p.wins++; p.summits++; p.gems += gems; s.stats.summits++;
            queueScore(p.uid, 'wins', 1);
            this.task(s, 'summit', 1);
            this.broadcast('summitfx', { s: s.id, n, name: p.name }, { except: s.client });
        }
        this.sendTo(s, 'landed', { n, got, win, gems, skipped: !!skipped });
        this.changed(s);
        if (win) this.broadcastBoards();
    }
    // a floating coin grabbed: one of a stage you've reached, near where you are, once in a while each
    onCoin(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const n = m.n | 0, i = m.i | 0, p = s.profile, now = Date.now();
        if (n < 1 || n > p.best) return;
        const c = coinAt(n, i);
        if (!c) return;
        const L = s.last;
        if (Math.hypot(L.x - c.x, L.y + 2.5 - c.y, L.z - c.z) > reachOf(p) + 7) return;
        const key = n + ':' + i;
        if (now - (s.coinT.get(key) || 0) < CFG.coinBack * 1000 - 1500) return;
        s.coinT.set(key, now);
        if (s.coinT.size > 400) for (const [k, t] of s.coinT) if (now - t > CFG.coinBack * 1000) s.coinT.delete(k);
        const rush = this.rushOn(now);
        let amt = pickupCoins(n) * coinMult(p, this.x2On(p, now), rush), lucky = false;
        if (Math.random() < luckOf(p)) { amt *= LUCK_MULT; lucky = true; }
        const got = this.addCoins(s, amt);
        p.pickups++; s.stats.pickups++;
        this.task(s, 'coins', 1);
        if (rush) this.task(s, 'rush', 1);
        this.sendTo(s, 'coin', { n, i, got, lucky });
        this.dirty(s);
    }
    // an ENTER key bounced on (the tasks count them): near one, not too often
    onBounce(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const now = Date.now(), n = m.n | 0, p = s.profile;
        if (now - s.bounceAt < 900 || n < 1 || n > p.best) return;
        const st = buildStage(n), k = st.keys.find((x) => x.kind === 'bounce');
        if (!k || Math.abs(s.last.y - k.top) > 30) return;
        s.bounceAt = now;
        p.bounces++;
        this.task(s, 'bounce', 1);
        this.dirty(s);
    }
    // the Bonk Glove: someone near you (not on a landing: those are safe) is knocked off their feet
    onSlap(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || typeof m.s !== 'string') return;
        const now = Date.now(), p = s.profile;
        if (now - s.slapAt < CFG.slapGap * 1000 - 200) return;
        const rainbow = !!m.rb && hasItem(p, 'rainbow');
        const L = s.last;
        const t = this.sessions.get(m.s), bot = !t && this.bots.find((b) => b.id === m.s);
        if (!t && !bot) return;
        const T = t ? t.last : bot.pl;
        if (Math.hypot(T.x - L.x, T.z - L.z) > CFG.slapReach + 5 || Math.abs(T.y - L.y) > 8) return;
        s.slapAt = now;
        this.broadcast('slapfx', { a: client.sessionId, b: m.s, rb: rainbow ? 1 : 0 });
        if (onAnyLanding(T.x, T.y, T.z)) { this.toast(s, '🛡️ Landings are safe spots: no bonking there!', RED); return; }
        const d = Math.hypot(T.x - L.x, T.z - L.z) || 1, dx = (T.x - L.x) / d, dz = (T.z - L.z) / d, pw = rainbow ? CFG.rainbowPush : CFG.slapPush;
        if (t) this.sendTo(t, 'bonked', { from: p.name, dx, dz, p: pw, rb: rainbow ? 1 : 0 });
        else this.knockBot(bot, dx, dz, pw);
        p.bonks++; s.stats.bonks++;
        this.task(s, 'bonk', 1);
        this.dirty(s);
    }
    // the stage picker: back to any landing you've reached
    onGoto(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const now = Date.now(), p = s.profile, n = m.n | 0;
        if (now - s.warpAt < 600 || n < 1 || n > p.best) return;
        s.warpAt = now;
        p.cp = n;
        this.sendHome(s, respawnAt(n, s.player.pid), 'goto');
        this.changed(s);
    }
    // a fall (or Boxity's Reset Character): back to your checkpoint (from the plaza: the plaza)
    onRespawn(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const now = Date.now(), p = s.profile;
        if (now - s.warpAt < 400) return;
        s.warpAt = now;
        if (m.fell) s.stats.falls++;
        const home = m.plaza || p.cp <= 1 && s.last.y < 3;
        this.sendHome(s, home ? { x: SPAWN.x + rnd(-5, 5), y: 0, z: SPAWN.z, ry: Math.PI } : respawnAt(p.cp, s.player.pid), m.fell ? 'fell' : 'reset');
    }
    // SKIP: the next landing, for Gems (or a rewarded ad: onAdSkip). Only from the landing you're climbing from, your best
    onSkip(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        if (p.cp !== p.best) { this.toast(s, 'Skips work from your best stage: pick it first', RED); return; }
        if (!this.payGems(s, skipGems(p.best), 'a stage skip')) return;
        this.skipTo(s);
    }
    async onAdSkip(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.skipAsking || typeof m.token !== 'string') return;
        s.skipAsking = true;
        const ok = await verifyAdReward(m.token);
        s.skipAsking = false;
        if (!this.sessions.has(client.sessionId)) return;
        if (!ok) { this.sendTo(s, 'adfail', {}); return; }
        if (s.profile.cp !== s.profile.best) s.profile.cp = s.profile.best;
        this.skipTo(s);
    }
    skipTo(s) {
        const p = s.profile, n = p.best + 1;
        s.stats.skips++;
        this.sendHome(s, respawnAt(n, s.player.pid), 'skip');
        this.reachLanding(s, n, true);
    }

    // ----- spending: upgrades, gear, trails, Capsules, Restack, the wheel, the Gem shop -----
    onUpgrade(client, m) {
        const s = this.sessions.get(client.sessionId), u = upgradeById[m.id];
        if (!s || !u) return;
        const p = s.profile, n = p.ups[u.id] || 0;
        if (n >= u.max) return;
        if (!this.payCoins(s, upgradeCost(u, n), u.name)) return;
        p.ups[u.id] = n + 1; p.upgrades++; s.stats.ups++;
        this.sendTo(s, 'bought', { what: 'upgrade', id: u.id, n: n + 1 });
        this.changed(s);
    }
    onItem(client, m) {
        const s = this.sessions.get(client.sessionId), it = itemById[m.id];
        if (!s || !it || it.free) return;
        const p = s.profile;
        if (hasItem(p, it.id)) return;
        if (it.gems ? !this.payGems(s, it.gems, it.name) : !this.payCoins(s, it.coins, it.name)) return;
        p.items[it.id] = 1;
        this.sendTo(s, 'bought', { what: 'item', id: it.id });
        this.changed(s);
    }
    onTrail(client, m) {
        const s = this.sessions.get(client.sessionId), tr = trailById[String(m.id || '')];
        if (!s || !tr) return;
        const p = s.profile;
        if (tr.id && !p.trails[tr.id]) {
            if (tr.gems ? !this.payGems(s, tr.gems, tr.name + ' trail') : !this.payCoins(s, tr.coins, tr.name + ' trail')) return;
            p.trails[tr.id] = 1;
            this.sendTo(s, 'bought', { what: 'trail', id: tr.id });
        }
        p.trail = tr.id;
        this.changed(s);
    }
    // a Capsule (from its stand on the plaza, or from the Pals panel anywhere up the tower)
    onBox(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, c = boxById[m.id], n = m.n === 3 ? 3 : 1;
        if (!c) return;
        if (c.gems ? !this.payGems(s, c.gems * n, c.name) : !this.payCoins(s, c.cost * n, c.name)) return;
        const out = [];
        for (let i = 0; i < n; i++) {
            let r = Math.random() * c.odds.reduce((a, x) => a + x, 0), j = 0;
            for (; j < c.buds.length - 1; j++) { r -= c.odds[j]; if (r < 0) break; }
            const id = c.buds[j];
            p.buds[id] = (p.buds[id] || 0) + 1;
            p.caps++; s.stats.caps++;
            this.task(s, 'caps', 1);
            out.push({ id, isNew: p.buds[id] === 1 });
            this.autoEquip(p, id);
        }
        // every Pal of a Capsule found: Gems, once
        if (!p.index[c.id] && c.buds.every((id) => p.buds[id] > 0)) { p.index[c.id] = 1; const g = INDEX_GEMS[c.tier] || 10; p.gems += g; this.sendTo(s, 'toastreward', { text: 'Collection complete: ' + c.name + '! +' + g + ' 💎' }); }
        this.sendTo(s, 'hatched', { c: c.id, out });
        this.changed(s);
    }
    autoEquip(p, id) {
        const max = teamSize(p), inTeam = p.team.filter((x) => x === id).length;
        if (inTeam >= p.buds[id]) return;
        if (p.team.length < max) { p.team.push(id); return; }
        let worst = 0;
        p.team.forEach((x, i) => { if (buddyById[x].mult < buddyById[p.team[worst]].mult) worst = i; });
        if (buddyById[id].mult > buddyById[p.team[worst]].mult) p.team[worst] = id;
    }
    onEquip(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, id = String(m.id || '');
        if (!buddyById[id] || !(p.buds[id] > 0)) return;
        const inTeam = p.team.filter((x) => x === id).length;
        if (m.off) { const i = p.team.indexOf(id); if (i >= 0) p.team.splice(i, 1); } else if (inTeam < p.buds[id] && p.team.length < teamSize(p)) p.team.push(id);
        else if (p.team.length >= teamSize(p)) this.toast(s, 'Your team is full: take one off first', RED);
        this.changed(s);
    }
    onEquipBest(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, all = [];
        for (const k of BUDDIES) for (let i = 0; i < Math.min(p.buds[k.id] || 0, 6); i++) all.push(k);
        all.sort((a, b) => b.mult - a.mult);
        p.team = all.slice(0, teamSize(p)).map((k) => k.id);
        this.changed(s);
    }
    // Restack: back to stage 1 with no Coins, x0.5 more Coins for good, Gems; your gear, upgrades and Pals stay
    onRestack(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, need = restackNeed(p.restacks);
        if (p.best < need) { this.toast(s, '🔁 Restack opens at stage ' + need, RED); return; }
        const gems = restackGems(p.restacks);
        p.restacks++; p.coins = 0; p.best = 1; p.cp = 1; p.gems += gems;
        s.stats.restacks++;
        s.againAt = {}; s.coinT.clear();
        this.sendHome(s, { x: SPAWN.x + rnd(-4, 4), y: 0, z: SPAWN.z, ry: Math.PI }, 'restack');
        this.sendTo(s, 'restacked', { r: p.restacks, gems });
        this.changed(s);
    }
    onSpin(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        if (p.spins < 1) return;
        p.spins--; p.spinsUsed++;
        let r = Math.random() * SPIN.reduce((a, x) => a + x.w, 0), i = 0;
        for (; i < SPIN.length - 1; i++) { r -= SPIN[i].w; if (r < 0) break; }
        const got = this.giveReward(s, SPIN[i]);
        this.task(s, 'spins', 1);
        this.sendTo(s, 'spun', { i, text: rewardText(got) });
        this.changed(s);
    }
    onPack(client, m) {
        const s = this.sessions.get(client.sessionId), k = s && PACKS.find((x) => x.id === m.id);
        if (!k || !this.payGems(s, k.gems, 'a Coin Pack')) return;
        const got = this.giveReward(s, { stages: k.stages });
        this.toast(s, '+' + rewardText(got, true) + '!', GOLD);
        this.changed(s);
    }
    onX2(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !this.payGems(s, CFG.boostX2Gems, 'x2 Coins')) return;
        const p = s.profile;
        p.x2Until = Math.max(Date.now(), p.x2Until || 0) + CFG.boostX2Mins * 60000;
        this.toast(s, '⚡ x2 Coins for ' + CFG.boostX2Mins + ' minutes!', GOLD);
        this.changed(s);
    }
    // the FREE x2 Coins: a rewarded ad watched, checked with Boxity (the token works once, for this game)
    async onAdX2(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.adAsking || typeof m.token !== 'string') return;
        s.adAsking = true;
        const ok = await verifyAdReward(m.token);
        s.adAsking = false;
        if (!this.sessions.has(client.sessionId)) return;
        if (!ok) { this.sendTo(s, 'adx2', { ok: false }); return; }
        const p = s.profile;
        p.x2Until = Math.max(Date.now(), p.x2Until || 0) + CFG.adX2Mins * 60000;
        this.sendTo(s, 'adx2', { ok: true, mins: CFG.adX2Mins });
        this.changed(s);
    }

    // ----- rewards -----
    onDaily(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, now = Date.now(), st = dailyStatus(p.daily, now);
        if (!st.can) return;
        p.daily = { last: dayKey(now), streak: st.streak + 1 };
        this.giveReward(s, DAILY[st.day], 'Daily reward: day ' + (st.day + 1) + '!');
        this.changed(s);
    }
    onGift(client, m) {
        const s = this.sessions.get(client.sessionId), i = m.i | 0, g = GIFTS[i];
        if (!s || !g || s.gifts[i] || s.playSecs < g.min * 60 - 2) return;
        s.gifts[i] = true;
        this.giveReward(s, g, 'FREE gift!');
        this.changed(s);
    }
    onCode(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const code = String(m.code || '').trim().toUpperCase().slice(0, 20), r = CODES[code];
        if (!r) { this.sendTo(s, 'code', { ok: false, text: 'That code doesn\'t work' }); return; }
        if (s.profile.codes[code]) { this.sendTo(s, 'code', { ok: false, text: 'You already used that code' }); return; }
        s.profile.codes[code] = true;
        const got = this.giveReward(s, r);
        this.sendTo(s, 'code', { ok: true, text: 'Code redeemed: ' + rewardText(got, true) });
        this.changed(s);
    }
    onTut(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        if (finite(m.tut)) s.profile.tut = clamp(Math.max(s.profile.tut, m.tut | 0), 0, 99);
        if (typeof m.seen === 'string' && m.seen.length < 24) s.profile.seen[m.seen] = 1;
        markDirty();
    }
    onMeta(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const st = s.stats;
        if (typeof m.touch === 'boolean') st.touch = m.touch;
        if (finite(m.fps)) { const f = clamp(Math.round(m.fps), 0, 240); st.fps = f; st.fpsSum += f; st.fpsN++; st.fpsMin = st.fpsN === 1 ? f : Math.min(st.fpsMin, f); }
        if (typeof m.q === 'string') st.q = m.q.slice(0, 8);
        if (typeof m.gpu === 'string' && !st.gpu) st.gpu = m.gpu.slice(0, 90);
        if (finite(m.load) && !st.load) st.load = clamp(Math.round(m.load * 10) / 10, 0, 600);
        if (!st.dev && finite(m.w)) st.dev = { w: clamp(m.w | 0, 0, 9999), h: clamp(m.h | 0, 0, 9999), dpr: clamp(num(m.dpr, 1), 0, 8), cores: clamp(m.cores | 0, 0, 256), mem: clamp(num(m.mem, 0), 0, 1024) };
        for (const e of arr(m.errs).slice(0, 5)) if (typeof e === 'string' && st.errs.length < 8) st.errs.push(e.slice(0, 220));
    }
    broadcastBoards(client) {
        const row = (key, f) => topProfiles(key).filter((p) => (p[key] || 0) > 0).map((p) => ({ n: p.name, v: Math.floor(f ? f(p) : p[key] || 0) }));
        const m = { top: row('top'), time: row('playtime') };
        if (client) client.send('boards', m); else this.broadcast('boards', m);
    }

    onQa(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        if (finite(m.coins)) { p.coins += m.coins; p.totalCoins += Math.max(0, m.coins); }
        if (finite(m.gems)) p.gems += m.gems;
        if (finite(m.best)) { p.best = clamp(m.best | 0, 1, 1e5); p.top = Math.max(p.top, p.best); p.cp = Math.min(p.cp, p.best); }
        if (finite(m.cp)) p.cp = clamp(m.cp | 0, 1, p.best);
        if (finite(m.wins)) p.wins = Math.max(0, m.wins | 0);
        if (finite(m.restacks)) p.restacks = clamp(m.restacks | 0, 0, 99);
        if (finite(m.spins)) p.spins = clamp(m.spins | 0, 0, 99);
        if (finite(m.qi)) p.qi = clamp(m.qi | 0, 0, QUESTS.length);
        if (finite(m.playSecs)) s.playSecs = m.playSecs | 0;
        if (m.ups && typeof m.ups === 'object') for (const id of Object.keys(m.ups)) { const u = upgradeById[id]; if (u) p.ups[id] = clamp(m.ups[id] | 0, 0, u.max); }
        if (Array.isArray(m.items)) for (const id of m.items) if (itemById[id]) p.items[id] = 1;
        if (m.tasks) { const jq = this.jqOf(p, Date.now()); for (const q of jq.list) q.p = TASKS[q.k].n; }
        if (Array.isArray(m.team)) { const ids = m.team.filter((id) => buddyById[id]).slice(0, 6); for (const id of ids) p.buds[id] = Math.max(1, p.buds[id] || 0); if (ids.length > teamSize(p)) p.ups.slots = Math.min(3, ids.length - 3); p.team = ids; }
        if (m.rush) { this.state.rush = Date.now() + CFG.rushSecs * 1000; this.broadcast('rush', { until: this.state.rush }); }
        if (finite(m.tut)) p.tut = m.tut | 0;
        // a QA teleport: where the next move is checked from
        if (Array.isArray(m.tp) && m.tp.every(finite)) { s.last = { x: m.tp[0], y: m.tp[1], z: m.tp[2] }; s.lastAt = Date.now(); s.homeAt = 0; s.moveB = undefined; s.riseB = undefined; }
        this.changed(s);
    }

    // ----- the bots: a few climbers on the lower stages when it's quiet (each real player sends one home). They hop from key to key
    // up the path (no physics: a hop from one key's top to the next), rest a moment on each landing, and now and then slip and start again
    fillBots() {
        const want = Math.max(0, CFG.bots - this.sessions.size);
        while (this.bots.length > want) { const b = this.bots.pop(); this.state.players.delete(b.id); }
        const used = new Set([...this.state.players.values()].map((p) => p.name));
        while (this.bots.length < want) {
            const id = 'bot' + Math.floor(Math.random() * 1e9);
            let name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
            for (let i = 0; used.has(name) && i < 20; i++) name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + (i > 10 ? i : '');
            used.add(name);
            const pl = new PlayerState(), top = 5 + Math.floor(Math.random() * 40), n = 1 + Math.floor(Math.random() * 6);
            const at = respawnAt(n, Math.floor(Math.random() * 9));
            Object.assign(pl, { name, bot: true, pid: this.freePid(), top, cp: n, wins: Math.floor(top / 10), title: titleOf(top), x: at.x, y: at.y, z: at.z, ry: at.ry, t: Date.now() });
            pl.team = Math.random() < 0.6 ? BUDDIES[Math.floor(Math.random() * 8)].id : '';
            pl.trail = Math.random() < 0.3 ? TRAILS[1 + Math.floor(Math.random() * 3)].id : '';
            pl.av = botAvatar();
            this.state.players.set(id, pl);
            const b = { id, pl, n, route: routeOf(n), i: 0, from: null, to: null, t0: 0, dur: 0, hop: 0, rest: Date.now() + rnd(500, 3000), goal: n + 3 + Math.floor(Math.random() * 16), knock: null };
            this.bots.push(b);
        }
    }
    knockBot(b, dx, dz, pw) {
        b.knock = { vx: dx * pw, vz: dz * pw, vy: CFG.slapLift + 8, t: 0 };
        b.from = null; b.to = null;
    }
    driveBot(b, now, dt) {
        const pl = b.pl;
        // bonked: flung off, then back on its landing
        if (b.knock) {
            const k = b.knock;
            k.t += dt; k.vy -= CFG.grav * dt;
            pl.x += k.vx * dt; pl.y += k.vy * dt; pl.z += k.vz * dt; pl.anim = 2; pl.t = now;
            if (k.t > 1.1) { b.knock = null; this.botTo(b, b.n, now + 1200); }
            return;
        }
        if (now < b.rest) { pl.anim = 0; pl.t = now; return; }
        if (!b.to) {
            if (b.i >= b.route.length - 1) {
                // the next landing: on to the next stage, or (its goal reached) slip back down to start again
                b.n++; pl.cp = b.n;
                if (b.n > b.goal) { b.goal = 3 + Math.floor(Math.random() * 18); this.botTo(b, 1 + Math.floor(Math.random() * 3), now + rnd(2000, 5000)); return; }
                b.route = routeOf(b.n); b.i = 0; b.rest = now + rnd(400, 2500);
                return;
            }
            b.from = b.route[b.i]; b.to = b.route[b.i + 1]; b.i++;
            const d = Math.hypot(b.to.x - b.from.x, b.to.z - b.from.z), rise = b.to.y - b.from.y;
            b.dur = Math.max(0.22, d / (CFG.walk * 0.85)) + (b.from.bounce ? 0.6 : 0);
            b.hop = b.from.bounce ? 16 : rise > 1.1 || d > 6.5 ? 2.2 + Math.max(0, rise) * 0.6 : 0;
            b.t0 = now;
            pl.ry = Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z);
        }
        const f = Math.min(1, (now - b.t0) / 1000 / b.dur);
        pl.x = b.from.x + (b.to.x - b.from.x) * f;
        pl.z = b.from.z + (b.to.z - b.from.z) * f;
        pl.y = b.from.y + (b.to.y - b.from.y) * f + b.hop * 4 * f * (1 - f);
        pl.anim = b.hop > 0 && f > 0.02 && f < 0.98 ? 2 : 1;
        pl.t = now;
        if (f >= 1) { b.from = null; b.to = null; if (Math.random() < 0.04) b.rest = now + rnd(300, 900); }
    }
    botTo(b, n, restUntil) {
        const at = respawnAt(n, Math.floor(Math.random() * 9)), pl = b.pl;
        b.n = n; b.route = routeOf(n); b.i = 0; b.from = null; b.to = null; b.rest = restUntil;
        pl.x = at.x; pl.y = at.y; pl.z = at.z; pl.ry = at.ry; pl.cp = n; pl.t = Date.now();
    }

    // ----- Bloxity -----
    async onBloxityLogin(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || s.authing) return;
        s.authing = true;
        const legion = await verifyBloxityToken(m.token);
        s.authing = false;
        if (!legion || !this.sessions.has(client.sessionId)) return;
        const uid = 'legion_' + legion.id;
        if (s.profile.uid === uid) return;
        const name = cleanName(legion.name) || s.profile.name;
        const guestProfile = s.profile;
        guestProfile.lastSeen = Date.now();
        this.flushBoards(s);
        await adoptGuestProgress(uid, guestProfile.uid, name, legion.carriedFrom);
        await loadProfile(uid);
        if (!this.sessions.has(client.sessionId)) return;
        kickOthers(uid, s);
        s.profile = getProfile(uid, name, randomName());
        this.fixProfile(s.profile);
        s.profile.lastSeen = Date.now();
        if (!isOnline(guestProfile.uid)) releaseProfile(guestProfile.uid, isOnline);
        s.player.name = s.profile.name;
        s.player.bx = legion.id;
        this.changed(s);
        client.send('authed', { name: s.profile.name });
        this.toast(s, 'Logged in as ' + s.profile.name, GREEN);
        this.broadcastBoards();
    }
    onAvatar(client, m) {
        const s = this.sessions.get(client.sessionId), now = Date.now();
        if (!s || !m || now - (s.avAt || 0) < 500) return;
        s.avAt = now;
        s.player.av = cleanAvatar(m.av);
    }
    onEmote(client, m) {
        const s = this.sessions.get(client.sessionId), now = Date.now();
        if (!s || !m || typeof m.id !== 'string' || m.id.length > 40 || now - (s.emoteAt || 0) < 700) return;
        s.emoteAt = now;
        this.broadcast('emote', { s: client.sessionId, id: m.id }, { except: client });
    }
    // (only when the page has no Boxity chat: Boxity relays and draws chat itself)
    onChat(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.text !== 'string') return;
        const now = Date.now();
        if (now - s.lastChat < 800) return;
        s.lastChat = now;
        const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (text) this.broadcast('chat', { s: client.sessionId, name: s.profile.name, text });
    }
}

const botAvatar = () => JSON.stringify({ e: { skinId: String(Math.floor(Math.random() * 21)) }, p: { height: Math.round(rnd(0.92, 1.08) * 100) / 100 } });
// the same player somewhere else (another tab, another server): they leave there
function kickOthers(uid, keep) {
    for (const room of liveRooms) for (const o of room.sessions.values()) if (o.profile.uid === uid && o !== keep) { try { if (o.recon) o.recon.reject(false); else o.client.leave(4000); } catch (e) { /* gone */ } }
}
function isOnline(uid) {
    for (const room of liveRooms) for (const s of room.sessions.values()) if (s.profile.uid === uid) return true;
    return false;
}
void landingTop; void landingBox; void secsNow; void ITEMS; void UPGRADES; void BOXES; void PACKS;
