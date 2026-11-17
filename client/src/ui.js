// The HUD (Coins, Gems and Wins and the menu on the left; the stage picker, SKIP and your quest at the top; the FREE gift and x2 Coins
// on the right; the tower gauge with everyone on it down the right edge; the tools hotbar at the bottom), the Capsule reveal, the Summit
// card, and every panel: the Gear Shop (upgrades, gear, trails, Gems, codes), Pals, a Capsule, the Prize Wheel, Restack, Stages, Quests,
// the daily reward, gifts, leaderboards, settings. Prices are Coins or Gems only.
import { $ } from './engine.js';
import { S, net, actions } from './state.js';
import { sfx, setMusicDuck, getVolumes, setVolume, playAsmr } from './audio.js';
import { setQuality, getQuality } from './fx.js';
import { buddyIcon } from './buddies.js';
import {
    CFG, RARITIES, SPIN, UPGRADES, upgradeCost, ITEMS, itemById, TRAILS, BUDDIES, buddyById, BOXES, boxById, restackNeed, restackGems, stackMult, palMult, teamSize,
    TASKS, QUESTS, DAILY, dailyStatus, dayLeft, GIFTS, PACKS, rewardText, rewardFor, clock, fmtComma, fmt, ODDS, LEADERBOARDS, skipGems, isSummit, zoneOf, skyOf,
    stageCoins, coinMult, hasItem, STAGES_PER_ZONE,
} from '../../shared/config.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const rar = (r) => `<span class="rar" style="color:${RARITIES[r].color}">${RARITIES[r].name}</span>`;
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const CC = '<i class="cc"></i>';
// a drawn icon (icons.js) for a panel's title
const IC = (k) => '<i class="ic ic-' + k + ' pic"></i>';
const sessionSecs = () => (S.sessionSecs || 0) + (Date.now() - S.profileAt) / 1000;
const img = (id, cls) => `<img src="${buddyIcon(id)}" alt="" class="buddyImg ${cls || ''}">`;
const x2Now = () => (S.x2Until || 0) > net.now();

// =====================================================================================
// Small things: toasts, big words, pop-ups
// =====================================================================================
// starts a CSS animation over without asking the page for its layout: the class comes back on the next frame
function replay(el) { el.classList.remove('go'); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('go'))); }
// (the same line twice within a few seconds shows once; never more than three at a time)
const toastSeen = new Map();
export function toast(text, color) {
    const now = performance.now();
    if (now - (toastSeen.get(text) || -1e9) < 3500) return;
    toastSeen.set(text, now);
    if (toastSeen.size > 40) for (const [k, v] of toastSeen) if (now - v > 3500) toastSeen.delete(k);
    const box = $('#toasts'), el = document.createElement('div');
    el.className = 'toast o1'; el.textContent = text; el.style.color = color || '#fff';
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), 3300);
}
// The big words in the middle of the screen: one at a time, each held a moment, never on top of a pop-up (they wait for it)
const bigQueue = [];
let bigBusyUntil = 0, popupUntil = 0;
export function bigText(text, color) {
    if (bigQueue.length && bigQueue[bigQueue.length - 1][0] === text) return;
    bigQueue.push([text, color]);
    if (bigQueue.length > 3) bigQueue.shift();
    pumpBig();
}
function pumpBig() {
    const now = performance.now();
    if (!bigQueue.length) return;
    const wait = Math.max(bigBusyUntil, popupUntil) - now;
    if (wait > 0) { clearTimeout(pumpBig.t); pumpBig.t = setTimeout(pumpBig, wait + 30); return; }
    const [text, color] = bigQueue.shift(), el = $('#bigText');
    el.textContent = text; el.style.color = color || '#ffe24a';
    el.hidden = false; replay(el);
    bigBusyUntil = now + 1500;
    clearTimeout(bigText.t); bigText.t = setTimeout(() => { el.hidden = true; }, 2300);
    if (bigQueue.length) { clearTimeout(pumpBig.t); pumpBig.t = setTimeout(pumpBig, 1530); }
}
// sub may hold the drawn icons (html)
export function popup(icon, title, sub, color, html) {
    const el = $('#popup');
    $('#bigText').hidden = true; popupUntil = performance.now() + 2700;
    $('#popIc').textContent = icon; $('#popT').textContent = title; $('#popT').style.color = color || '#ffe24a';
    if (html) $('#popS').innerHTML = sub || ''; else $('#popS').textContent = sub || '';
    el.hidden = false; replay(el);
    clearTimeout(popup.t); popup.t = setTimeout(() => { el.hidden = true; }, 3000);
}
export function notEnough(m) {
    sfx('denied');
    const gems = m.cur === 'gems';
    askConfirm(gems ? '💎' : '🪙', 'Not enough ' + (gems ? 'Gems' : 'Coins'), `You need ${fmtComma(m.need)} more ${gems ? 'Gems' : 'Coins'} for ${esc(m.name)}.` + (gems ? '<br><small>Gems come from quests, daily tasks, gifts, the wheel, Summits and the daily reward.</small>' : '<br><small>Climb to new landings and grab the floating coins on the stairs.</small>'),
        gems ? 'Quests' : 'OK', () => { if (gems) openPanel('quests'); });
}
export function codeResult(m) { toast(m.ok ? '🎟️ ' + m.text : m.text, m.ok ? '#7dff6b' : '#ff7a8a'); if (m.ok) sfx('reward'); else sfx('denied'); }

// =====================================================================================
// The HUD (written only when a value changes; bars and dots move with transforms)
// =====================================================================================
const shown = { c: 0, g: 0 }, shownTxt = { c: '', g: '' };
const cdShown = {};
export function animateCounters(dt) {
    // Coins and Gems count up quickly
    const kf = Math.min(1, dt * 14);
    for (const [key, v, sel, f] of [['c', S.coins, '#coinVal', fmtCoins], ['g', S.gems, '#gemVal', fmtComma]]) {
        const target = v || 0;
        shown[key] += (target - shown[key]) * kf;
        if (Math.abs(target - shown[key]) < 0.05) shown[key] = target;
        const txt = f(shown[key]);
        if (txt !== shownTxt[key]) { shownTxt[key] = txt; $(sel).textContent = txt; }
    }
    // the tools' cooldowns: a shade sliding down each slot
    if (actions.toolCooldown) for (const id of ['glove', 'hop', 'rainbow']) {
        const k = Math.round(actions.toolCooldown(id) * 40) / 40;
        if (k === cdShown[id]) continue;
        cdShown[id] = k;
        const el = document.querySelector('#hotbar [data-tool="' + id + '"] .cd');
        if (el) el.style.transform = 'scaleY(' + k + ')';
    }
}
const fmtCoins = (v) => (v < 100000 ? fmtComma(Math.floor(v)) : fmt(v));
const POP = [{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: 0.35 }, { transform: 'scale(1)' }];
export function bump(sel) { const el = $(sel); if (el && el.animate) el.animate(POP, { duration: 420, easing: 'cubic-bezier(0.34, 1.6, 0.5, 1)' }); }
// a big win: coins burst out of the middle of the screen and stream into the Coins counter
let coinsAt = null, flying = 0;
export function flyCoins(n) {
    if (!coinsAt || flying > 24) return;
    const box = $('#flyLayer'), k = Math.min(6, Math.max(1, n));
    const fx = innerWidth / 2, fy = innerHeight * 0.42;
    for (let i = 0; i < k; i++) {
        const el = document.createElement('i');
        el.className = 'cc';
        box.appendChild(el);
        flying++;
        const a = Math.random() * Math.PI * 2, r = 50 + Math.random() * 80, sx = fx + Math.cos(a) * r, sy = fy + Math.sin(a) * r * 0.7;
        const at = (x, y, sc) => 'translate(' + x.toFixed(0) + 'px,' + y.toFixed(0) + 'px) translate(-50%,-50%) scale(' + sc + ')';
        const anim = el.animate([
            { transform: at(fx, fy, 0.2), opacity: 0 },
            { transform: at(sx, sy, 1.3), opacity: 1, offset: 0.3 },
            { transform: at(coinsAt.x, coinsAt.y, 0.75), opacity: 1 },
        ], { duration: 760 + i * 55, delay: i * 45, easing: 'cubic-bezier(0.45, 0, 0.65, 1)', fill: 'both' });
        anim.onfinish = () => { el.remove(); flying--; bump('#coinBox'); playAsmr('step', 0.12, 1.4 + i * 0.05); };
    }
}
// the guide for someone new: one step at a time, in the quest's place (text, step, steps)
let tutorial = null;
export function setTutorial(t) { const k = t ? t.text + t.step : ''; if (k === (tutorial ? tutorial.text + tutorial.step : '')) return; tutorial = t; updateHud(); }
// RAINBOW RUSH: seconds left (0: none)
let rushLeft = 0;
export function setRush(left) { const l = Math.max(0, Math.ceil(left)); if (l === rushLeft) return; rushLeft = l; const el = $('#rushBar'); el.hidden = l <= 0; if (l > 0) el.textContent = '🌈 RAINBOW RUSH · x3 COINS · ' + clock(l); }
// the tower gauge down the right edge: everyone on the tower, by stage (you in front, a flag at your best)
let gaugeKey = '';
export function setGauge(list, best) {
    const top = Math.max(best + 3, ...list.map((p) => p.s + 2), 10), bot = 1;
    const key = list.map((p) => p.n + ':' + p.s).join('|') + '/' + best;
    if (key === gaugeKey) return;
    gaugeKey = key;
    const g = $('#gauge'), dots = g.querySelector('.gdots');
    const pos = (s) => (1 - (s - bot) / (top - bot)) * 100;
    $('#gTop').textContent = String(top); $('#gBest').style.top = pos(best + 1).toFixed(1) + '%';
    const sorted = list.slice().sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0)).slice(-14);
    while (dots.children.length < sorted.length) { const d = document.createElement('i'); d.className = 'gd'; dots.appendChild(d); }
    for (let i = 0; i < dots.children.length; i++) {
        const d = dots.children[i], p = sorted[i];
        if (!p) { d.hidden = true; continue; }
        d.hidden = false;
        d.classList.toggle('me', !!p.me);
        d.title = p.n + ' · stage ' + p.s;
        d.style.top = pos(p.s).toFixed(1) + '%';
        if (p.me) d.textContent = 'YOU'; else d.textContent = '';
    }
}
const put = (sel, v, html) => { const el = $(sel); if (!el) return; if (html) { if (el.innerHTML !== v) el.innerHTML = v; } else if (el.textContent !== v) el.textContent = v; };
export function updateHud() {
    const best = S.best || 1, cp = S.cp || 1;
    // the stage picker
    put('#stageNum', 'STAGE ' + fmtComma(cp));
    const nextSummit = Math.ceil(best / STAGES_PER_ZONE) * STAGES_PER_ZONE + 1, toSummit = nextSummit - best;
    put('#stageSub', cp < best ? 'Best ' + fmtComma(best) + ' · tap BEST to go back' : toSummit === STAGES_PER_ZONE ? 'Summit in ' + toSummit + ' · ' + zoneOf(best).name : 'Summit in ' + toSummit + ' stage' + (toSummit > 1 ? 's' : ''));
    $('#bPrev').disabled = cp <= 1; $('#bNext').disabled = cp >= best;
    $('#bBest').hidden = cp >= best;
    put('#skipTxt', '💎 ' + skipGems(best));
    const adOk = !!(actions.adsOk && actions.adsOk());
    $('#bAdSkip').hidden = !adOk;
    $('#bAdX2').hidden = !adOk;
    put('#winVal', fmtComma(S.wins || 0));
    // the quest (or the guide's step)
    const Q = QUESTS[S.qi], ql = $('#questLine');
    ql.classList.toggle('tut', !!tutorial);
    if (tutorial) {
        put('#questLine', 'STEP ' + (tutorial.step + 1) + '/' + tutorial.of + ' · ' + tutorial.text);
        ql.classList.remove('ready');
        ql.hidden = false;
    } else if (Q) {
        const p = Math.min(Q.n, S.qv || 0), ready = p >= Q.n;
        put('#questLine', ready ? '✅ ' + Q.text + ' · Claim!' : '🎯 ' + Q.text + ' ' + fmt(p) + '/' + fmt(Q.n));
        ql.classList.toggle('ready', ready);
        ql.hidden = false;
    } else ql.hidden = true;
    // FOR FREE: the next playtime gift
    const secs = sessionSecs(), gi = GIFTS.findIndex((g, i) => !S.gifts[i]);
    const gb = $('#bGift');
    if (gi < 0) gb.hidden = true;
    else {
        gb.hidden = false;
        const left = GIFTS[gi].min * 60 - secs;
        gb.classList.toggle('ready', left <= 0);
        put('#giftTxt', left <= 0 ? 'CLAIM!' : clock(left));
        put('#giftWhat', rewardText(rewardFor(S, GIFTS[gi])), true);
    }
    // x2 Coins (Gems, or FREE for an ad)
    const x2 = x2Now();
    put('#x2Txt', x2 ? clock(((S.x2Until || 0) - net.now()) / 1000) + ' left' : '💎 ' + CFG.boostX2Gems + ' · ' + CFG.boostX2Mins + ' min');
    $('#bX2').classList.toggle('on', x2);
    put('#adX2Txt', 'FREE · ' + CFG.adX2Mins + ' min');
    // what a landing pays now
    const m = coinMult(S, x2, false);
    put('#mCoin', '+' + fmt(Math.round(stageCoins(best + 1) * m)) + ' next landing');
    put('#mMult', m > 1 ? 'x' + (Math.round(m * 100) / 100) + ' Coins' : '');
    // the hotbar: what you own
    for (const el of document.querySelectorAll('#hotbar [data-tool]')) {
        const id = el.dataset.tool, own = hasItem(S, id);
        el.classList.toggle('lock', !own);
        if (id === 'carpet') el.classList.toggle('on', own && !!S.carpetOn);
    }
    // badges: something to do
    const ds = dailyStatus(S.daily, net.now());
    setBadge('#bDaily', ds.can ? '!' : '');
    const list = (S.jq && S.jq.list) || [];
    setBadge('#bQuests', (list.some((q) => !q.c && TASKS[q.k] && q.p >= TASKS[q.k].n) || (Q && (S.qv || 0) >= Q.n)) ? '!' : '');
    setBadge('#bSpin', S.spins > 0 ? String(S.spins) : '');
    setBadge('#bRestack', best >= restackNeed(S.restacks) ? '!' : '');
    const canUp = UPGRADES.some((u) => { const n = (S.ups && S.ups[u.id]) || 0; return n < u.max && S.coins >= upgradeCost(u, n); }) || ITEMS.some((it) => !it.free && !hasItem(S, it.id) && it.coins && S.coins >= it.coins);
    setBadge('#bShop', canUp ? '!' : '');
    setBadge('#bPals', !S.caps && S.coins >= BOXES[0].cost ? 'NEW' : '');
    tickPanel();
}
// The open panel's timers, written once a second on their own: a panel rebuilt under a finger loses the tap. It's rebuilt only when
// what it shows changes (a gift's time comes).
function tickPanel() {
    const m = $('#modal');
    if (m.hidden || !panelKind) return;
    const set = (sel, text) => { const el = m.querySelector(sel); if (el && el.textContent !== text) el.textContent = text; };
    if (panelKind === 'quests') set('[data-t="day"]', 'Resets in ' + clock(dayLeft(net.now())));
    else if (panelKind === 'daily') set('[data-t="daily"]', 'Next reward in ' + clock(dayLeft(net.now())));
    else if (panelKind === 'spin' && !spinning) {
        const left = Math.max(0, (S.spinIn || 0) - (Date.now() - S.profileAt) / 1000);
        set('[data-t="spin"]', S.spins >= CFG.spinMax ? 'Spins full: use one!' : 'Next free spin in ' + clock(left));
    } else if (panelKind === 'gifts') {
        const secs = sessionSecs();
        for (let i = 0; i < GIFTS.length; i++) {
            if (S.gifts[i]) continue;
            const left = GIFTS[i].min * 60 - secs, b = m.querySelector('[data-act="gift"][data-i="' + i + '"]');
            if (!b) continue;
            if (left <= 0 && b.disabled) { renderPanel(); return; }
            if (left > 0) set('[data-act="gift"][data-i="' + i + '"]', clock(left));
        }
    }
}
function setBadge(sel, text) {
    const el = $(sel);
    let b = el.querySelector('.badge');
    if (!text) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'badge'; el.appendChild(b); }
    if (b.textContent !== text) b.textContent = text;
}
export function measureHud() {
    const w = $('#coinBox .cc').getBoundingClientRect(); if (w.width > 0) coinsAt = { x: w.left + w.width / 2, y: w.top + w.height / 2 };
}

// =====================================================================================
// A Summit: the card (stage, Coins, the Win, Gems), Boxity's results screen round it
// =====================================================================================
export function summitCard(m, onClose) {
    const el = $('#summit');
    const sn = Math.floor((m.n - 1) / STAGES_PER_ZONE);
    el.innerHTML = `<div class="panel"><header><h2 class="o">🏆 Summit ${sn}!</h2><div class="hx"><button class="btn g-red o x" data-close>✕</button></div></header><div></div>
        <div class="srBody"><span class="srN o">${m.n - 1}</span><span class="srS o1">stages climbed · ${esc(m.zone)} next</span>
        <span class="srBest o">+1 WIN · +${m.gems} 💎</span>
        <span class="srS o1">+${fmt(m.got)} ${CC} · ${fmtComma(m.wins)} Wins in all</span>
        <div class="btns" style="display:flex;gap:.6rem;margin-top:.4rem"><button class="btn g-green o" data-again style="min-width:9rem;height:2.8rem;font-size:1.2rem">Keep climbing!</button><button class="btn g-blue o" data-ranks style="min-width:7rem;height:2.8rem;font-size:1.2rem">Ranks</button></div></div><div></div></div>`;
    el.hidden = false;
    const close = () => { el.hidden = true; if (onClose) onClose(); };
    el.querySelector('[data-close]').onclick = () => { sfx('close'); close(); };
    el.querySelector('[data-again]').onclick = () => { sfx('click'); close(); };
    el.querySelector('[data-ranks]').onclick = () => { sfx('click'); close(); openPanel('ranks'); };
    el.onclick = (e) => { if (e.target === el) close(); };
    clearTimeout(summitCard.t); summitCard.t = setTimeout(() => { if (!el.hidden) close(); }, 7000);
    actions.onSummitClosed = onClose;
}

// =====================================================================================
// A Capsule opening: it wobbles, it pops, your Pals
// =====================================================================================
let hatchT = 0;
export function showHatch(boxId, out, auto) {
    const c = boxById[boxId], box = $('#hatchCaps'), H = $('#hatch');
    clearTimeout(hatchT);
    box.innerHTML = out.map(() => `<div class="hc"><div class="cap" style="--cc:${hex(c.color)}"></div></div>`).join('');
    $('#hatchOk').hidden = true;
    H.hidden = false;
    sfx('shake');
    hatchT = setTimeout(() => {
        sfx('crack');
        box.innerHTML = out.map((o) => { const k = buddyById[o.id]; return `<div class="hc">${o.isNew ? '<span class="newb o1">NEW!</span>' : ''}<img src="${buddyIcon(k.id)}" alt=""><b class="o">${esc(k.name)}</b><small class="o1">${rar(k.rarity)} · x${k.mult}</small></div>`; }).join('');
        $('#hatchOk').hidden = false;
        if (actions.onHatched) actions.onHatched(out);
        if (auto) hatchT = setTimeout(closeHatch, 1300);
    }, 720);
}
export function closeHatch() { clearTimeout(hatchT); $('#hatch').hidden = true; if (actions.afterHatch) actions.afterHatch(); }
export const hatchOpen = () => !$('#hatch').hidden;
$('#hatchOk').addEventListener('click', () => { sfx('click'); closeHatch(); });

// =====================================================================================
// Panels
// =====================================================================================
let panelKind = null, panelTab = null, panelArg = null, spinning = false, wheelAngle = 0;
export function openPanel(kind, tab) {
    panelKind = kind; panelTab = tab || null;
    if (kind === 'box') { panelArg = tab; panelTab = null; }
    $('#modal').hidden = false;
    renderPanel();
    sfx('open');
    setMusicDuck(true);
    if (actions.onPanel) actions.onPanel(true, kind);
}
export function closePanel() {
    if ($('#modal').hidden) return false;
    $('#modal').hidden = true; panelKind = null; renderedKind = null;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    setMusicDuck(false);
    if (actions.onPanel) actions.onPanel(false);
    sfx('close');
    return true;
}
export const panelIs = (k) => !$('#modal').hidden && panelKind === k;
export function refreshPanels() { if (!$('#modal').hidden && !(panelKind === 'spin' && spinning)) renderPanel(); }
function frame(title, icon, body, opts) {
    opts = opts || {};
    return `<div class="panel ${opts.cls || ''}"${opts.w ? ` style="width:min(${opts.w}rem,94vw)"` : ''}>
        <header><h2 class="o">${icon} ${title}</h2><div class="hx">${opts.hx || ''}<button class="btn g-red o x" data-close>✕</button></div></header>
        ${opts.tabs ? `<div class="tabs">${opts.tabs.map(([k, l]) => `<button class="tab o1${k === opts.tab ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>` : '<div></div>'}
        <div class="body">${body}</div>${opts.foot ? `<div class="foot">${opts.foot}</div>` : '<div></div>'}</div>`;
}
let renderedKind = null, renderedHtml = '';
function renderPanel() {
    const m = $('#modal');
    const again = renderedKind === panelKind && !m.hidden && m.firstElementChild;
    const html = PANELS[panelKind] ? PANELS[panelKind]() : '';
    if (again && html === renderedHtml) return;
    renderedHtml = html;
    const scroller = again && m.querySelector('.body'), keep = scroller ? scroller.scrollTop : 0;
    m.innerHTML = html;
    renderedKind = panelKind;
    // a refresh of the open panel (a timer, a new value): no pop-in again, the scroll stays where it was
    if (again && m.firstElementChild) { m.firstElementChild.classList.add('still'); const b2 = m.querySelector('.body'); if (b2 && keep) b2.scrollTop = keep; }
    const x = m.querySelector('[data-close]');
    if (x) x.onclick = () => closePanel();
    m.onclick = (e) => { if (e.target === m) closePanel(); };
    for (const b of m.querySelectorAll('[data-tab]')) b.onclick = () => { panelTab = b.dataset.tab; sfx('click'); renderPanel(); };
    for (const b of m.querySelectorAll('[data-act]')) b.onclick = (e) => { e.stopPropagation(); doAct(b.dataset.act, b.dataset); };
    const code = m.querySelector('#codeIn');
    if (code) code.onkeydown = (e) => { if (e.key === 'Enter') doAct('code', {}); };
    for (const r of m.querySelectorAll('input[type=range]')) { r.oninput = () => setVolume(r.dataset.vol, r.value / 100); r.onchange = () => { if (r.dataset.vol === 'music' && actions.saveSetting) actions.saveSetting({ music_volume: +r.value }); }; }
}
// a wheel prize's label
const spinLabel = (s) => (s.stages ? CC + ' ' + (s.stages >= 12 ? 'HUGE' : s.stages >= 5 ? 'BIG' : 'Coins') : s.gems ? '💎 ' + s.gems : s.x2 ? 'x2 ' + s.x2 + 'm' : '');
const palCard = (k, inTeam, count) => `<div class="card${inTeam ? ' on' : ''}">${count > 1 ? `<span class="palN o1">x${count}</span>` : ''}<div class="ci">${img(k.id)}</div><b class="o1">${esc(k.name)}</b><small>${rar(k.rarity)}</small><span class="palX o1">x${k.mult} Coins</span>
    ${inTeam ? `<button class="btn g-red o1" data-act="unequip" data-id="${k.id}">Take off</button>` : `<button class="btn g-green o1" data-act="equip" data-id="${k.id}">Equip</button>`}</div>`;
const price = (o) => (o.gems ? '💎 ' + fmtComma(o.gems) : CC + ' ' + fmt(o.coins || o.cost || 0));
const affordable = (o) => (o.gems ? S.gems >= o.gems : S.coins >= (o.coins || o.cost || 0));
const PANELS = {
    shop() {
        const tab = panelTab || 'up';
        let body = '';
        if (tab === 'up') {
            body = UPGRADES.map((u) => {
                const n = (S.ups && S.ups[u.id]) || 0, max = n >= u.max, cost = upgradeCost(u, n), can = !max && S.coins >= cost;
                return `<div class="row"><div class="ri"><span class="ci" style="font-size:2.4rem">${u.icon}</span></div><div class="rt"><b class="o1">${esc(u.name)} <small style="display:inline;font-weight:700;color:#7dff6b">${u.stat(n)}</small></b><small>${esc(u.text)}</small><div class="prog"><i style="width:${(n / u.max * 100).toFixed(0)}%"></i></div></div><div class="rb"><button class="btn ${max ? 'g-grey' : can ? 'g-green' : 'g-grey'} o1" data-act="upgrade" data-id="${u.id}" ${max ? 'disabled' : ''}>${max ? 'MAX' : CC + ' ' + fmt(cost)}</button></div></div>`;
            }).join('');
        } else if (tab === 'gear') {
            body = ITEMS.filter((it) => !it.free).map((it) => {
                const own = hasItem(S, it.id), can = affordable(it);
                return `<div class="row${own ? ' feat' : ''}"><div class="ri"><span class="ci" style="font-size:2.4rem">${it.icon}</span></div><div class="rt"><b class="o1">${esc(it.name)}</b><small>${esc(it.text)}</small></div><div class="rb"><button class="btn ${own ? 'g-grey' : can ? (it.gems ? 'g-gem' : 'g-green') : 'g-grey'} o1" data-act="item" data-id="${it.id}" ${own ? 'disabled' : ''}>${own ? 'OWNED ✓' : price(it)}</button></div></div>`;
            }).join('') + '<p style="margin:.6rem 0 0;font-weight:600;opacity:.85">Tools go on the hotbar at the bottom of the screen (keys 1-4). The Bonk Glove is free: click, tap it or press F.</p>';
        } else if (tab === 'trails') {
            body = '<div class="grid">' + TRAILS.map((tr) => {
                const own = !tr.id || (S.trails && S.trails[tr.id]), on = (S.trail || '') === tr.id;
                const sw = tr.rainbow ? 'background:linear-gradient(90deg,#ff5a8a,#ffd23a,#6ae86a,#3ad8e8,#b46aff)' : `background:${hex(tr.color)}`;
                return `<div class="card${on ? ' on' : ''}"><div class="ci"><span style="display:block;width:2.6rem;height:.9rem;border-radius:1rem;${tr.id ? sw : 'background:#5a5a7a'};box-shadow:0 0 .6rem rgba(255,255,255,.5)"></span></div><b class="o1">${esc(tr.name)}</b><button class="btn ${on ? 'g-grey' : own ? 'g-blue' : affordable(tr) ? (tr.gems ? 'g-gem' : 'g-green') : 'g-grey'} o1" data-act="trail" data-id="${tr.id}" ${on ? 'disabled' : ''}>${on ? 'ON' : own ? 'Wear' : price(tr)}</button></div>`;
            }).join('') + '</div><p style="margin:.6rem 0 0;font-weight:600;opacity:.85">Everyone on the tower sees your trail.</p>';
        } else if (tab === 'gems') {
            const x2 = x2Now(), base = rewardFor(S, { stages: 1 }).coins || 1;
            const packs = PACKS.map((p, i) => `<div class="card"><div class="ci">${['🪙', '💰', '🏆'][i]}</div><b class="o1">${fmt(p.stages * base)} ${CC}</b><small>${p.stages} landings' worth</small><button class="btn g-gem o" data-act="pack" data-id="${p.id}">💎 ${p.gems}</button></div>`).join('');
            body = `<div class="grid">${packs}<div class="card"><div class="ci">⚡</div><b class="o1">x2 Coins · ${CFG.boostX2Mins} min</b><small>${x2 ? 'Active: ' + clock(((S.x2Until || 0) - net.now()) / 1000) + ' left' : 'Double every coin'}</small><button class="btn g-gem o" data-act="x2">💎 ${CFG.boostX2Gems}</button></div></div>
                <p style="margin:.8rem 0 0;font-weight:600;opacity:.85">💎 Gems come from quests, daily tasks, gifts, the wheel, Summits and the daily reward. Everything is bought with Coins or Gems.</p>`;
        } else {
            body = `<h3 style="margin:.2rem 0 .5rem">🎟️ Codes</h3><div style="display:flex;gap:.5rem"><input class="code" id="codeIn" maxlength="20" placeholder="Enter a code"><button class="btn g-green o" data-act="code" style="min-width:6rem">Redeem</button></div>
                <p style="margin:.8rem 0 0;font-weight:600;opacity:.85">Codes give free Coins, Gems, spins and x2. Try CLACKSTACK!</p>`;
        }
        return frame('Gear Shop', IC('shop'), body, { tabs: [['up', '⬆️ Upgrades'], ['gear', '🎒 Gear'], ['trails', '✨ Trails'], ['gems', '💎 Gems'], ['codes', '🎟️ Codes']], tab, hx: `<span class="o1">${CC} ${fmtComma(S.coins)}</span>` });
    },
    pals() {
        const tab = panelTab || 'team', team = S.team || [], mult = Math.round(palMult(S) * 100) / 100;
        let body = '';
        if (tab === 'team') {
            const owned = BUDDIES.filter((k) => (S.buds || {})[k.id] > 0).sort((a, b) => b.mult - a.mult);
            body = `<p class="o1" style="margin:0 0 .6rem;font-weight:700">Team: ${team.length} / ${teamSize(S)} · Coins x${mult} <button class="btn g-blue o1" data-act="equipbest" style="margin-left:.5rem;padding:.15rem .7rem;font-size:.95rem">Equip best</button></p>`;
            body += owned.length ? '<div class="grid">' + owned.map((k) => palCard(k, team.includes(k.id), S.buds[k.id])).join('') + '</div>' : '<p class="o1" style="font-weight:700">No Pals yet. Open a Capsule (the Capsules tab, or a stand on the plaza)!</p>';
        } else if (tab === 'caps') {
            body = '<div class="grid">' + BOXES.map((c) => {
                const one = c.gems ? { gems: c.gems } : { coins: c.cost }, seen = c.buds.filter((id) => (S.buds || {})[id] > 0).length;
                return `<div class="card"><div class="ci"><span style="display:block;width:3.2rem;height:3.2rem;border-radius:50%;border:.2rem solid var(--ink);background:linear-gradient(${hex(c.color)} 0 50%, #f4f6ff 50%)"></span></div><b class="o1">${esc(c.name)}</b><small>${seen} / ${c.buds.length} found</small><button class="btn ${affordable(one) ? (c.gems ? 'g-gem' : 'g-green') : 'g-grey'} o1" data-act="openbox" data-id="${c.id}">${price(one)}</button></div>`;
            }).join('') + '</div>';
        } else {
            body = BOXES.map((c) => {
                const seen = c.buds.filter((id) => (S.buds || {})[id] > 0).length;
                return `<div class="row"><div class="rt"><b class="o1">${esc(c.name)} ${seen === c.buds.length ? '✅' : ''}</b><small>${seen} / ${c.buds.length} found${S.index && S.index[c.id] ? ' · collection reward claimed' : ' · find them all for Gems'}</small></div><div class="rb">${c.buds.map((id) => { const k = buddyById[id], got = (S.buds || {})[id] > 0; return `<span style="width:3rem;height:3rem;display:inline-block" title="${esc(got ? k.name : '???')}">${img(id, got ? '' : 'dim')}</span>`; }).join('')}</div></div>`;
            }).join('');
        }
        return frame('Pals', IC('pals'), body, { tabs: [['team', 'My Team'], ['caps', '🥚 Capsules'], ['index', 'Index']], tab, foot: 'Pals multiply every coin you earn. Open Capsules here or at their stands on the plaza.' });
    },
    box() {
        const c = boxById[panelArg];
        if (!c) return '';
        const total = ODDS.reduce((a, x) => a + x, 0);
        const odds = c.buds.map((id, j) => { const k = buddyById[id], got = (S.buds || {})[id] > 0; return `<div class="card"><div class="ci">${img(id, got ? '' : 'dim')}</div><b class="o1">${got ? esc(k.name) : '???'}</b><small>${rar(k.rarity)}</small><span class="palX o1">x${k.mult} · ${Math.round(c.odds[j] / total * 1000) / 10}%</span></div>`; }).join('');
        const one = c.gems ? { gems: c.gems } : { coins: c.cost }, three = c.gems ? { gems: c.gems * 3 } : { coins: c.cost * 3 };
        const body = `<div class="capOdds">${odds}</div><div class="capBtns"><button class="btn ${affordable(one) ? 'g-green' : 'g-grey'} o" data-act="hatch" data-n="1">Open 1 · ${price(one)}</button><button class="btn ${affordable(three) ? 'g-yellow' : 'g-grey'} o" data-act="hatch" data-n="3">Open 3 · ${price(three)}</button></div>
            <p class="o1" style="margin:.6rem 0 0;text-align:center;font-weight:700">You have ${CC} ${fmtComma(S.coins)} · 💎 ${fmtComma(S.gems)}</p>`;
        return frame(esc(c.name), IC('pals'), body, { w: 38 });
    },
    spin() {
        const n = SPIN.length, seg = 360 / n;
        const grad = SPIN.map((s, i) => `${s.color} ${(i * seg).toFixed(2)}deg ${((i + 1) * seg).toFixed(2)}deg`).join(',');
        const labels = SPIN.map((s, i) => `<span class="wl" style="transform:rotate(${((i + 0.5) * seg).toFixed(2)}deg)"><b class="o1">${spinLabel(s)}</b></span>`).join('');
        const left = Math.max(0, (S.spinIn || 0) - (Date.now() - S.profileAt) / 1000);
        const body = `<div class="wheelWrap"><div class="wptr"></div><div class="wheel" id="wheel" style="background:conic-gradient(${grad});transform:rotate(${wheelAngle}deg)">${labels}</div><div class="whub o">SPIN</div></div>
            <div style="text-align:center;margin-top:.8rem"><button class="btn ${S.spins > 0 ? 'g-green' : 'g-grey'} o" data-act="spin" ${S.spins > 0 && !spinning ? '' : 'disabled'} style="min-width:12rem;height:3.2rem;font-size:1.5rem">${S.spins > 0 ? 'Spin! (' + S.spins + ')' : 'No spins left'}</button>
            <p class="o1" data-t="spin" style="margin:.5rem 0 0;font-weight:700">${S.spins >= CFG.spinMax ? 'Spins full: use one!' : 'Next free spin in ' + clock(left)}</p></div>`;
        return frame('Prize Wheel', IC('spin'), body, { w: 30, foot: 'A free spin every ' + CFG.spinMins + ' minutes of play (up to ' + CFG.spinMax + ' saved). Coin prizes grow as you climb.' });
    },
    restack() {
        const r = S.restacks || 0, need = restackNeed(r), best = S.best || 1, can = best >= need;
        const body = `<div class="rebBox"><div class="rebRow"><span>Restacks</span><b>${r}</b><i>→</i><b class="g">${r + 1}</b></div>
            <div class="rebRow"><span>Coins</span><b>x${stackMult(r)}</b><i>→</i><b class="g">x${stackMult(r + 1)}</b></div>
            <div class="rebNew o1">+${restackGems(r)} 💎 now</div>
            <div class="prog" style="width:min(22rem,80vw);height:1rem"><i style="width:${Math.min(100, best / need * 100).toFixed(1)}%"></i></div>
            <small class="o1" style="font-weight:700">Stage ${fmtComma(best)} / ${fmtComma(need)}</small>
            <p class="rebWarn">You go back to stage 1 and your Coins go back to nothing. You keep your upgrades, gear, trails, Pals, Gems, Wins and your highest stage on the boards. Every coin pays more from now on.</p>
            <button class="btn ${can ? 'g-pink' : 'g-grey'} o" data-act="restack" style="min-width:14rem;height:3.4rem;font-size:1.5rem">${can ? 'RESTACK!' : '🔒 Stage ' + need}</button></div>`;
        return frame('Restack', IC('rebirth'), body, { w: 32 });
    },
    stages() {
        const best = S.best || 1, cp = S.cp || 1;
        // every landing you've reached: the last ones first, Summits marked; long lists show the Summits and the last 30
        const list = [];
        for (let n = best; n >= 1 && list.length < 30; n--) list.push(n);
        for (let n = Math.floor((best - 31) / STAGES_PER_ZONE) * STAGES_PER_ZONE + 1; n >= 11; n -= STAGES_PER_ZONE) if (!list.includes(n)) list.push(n);
        if (!list.includes(1)) list.push(1);
        const body = `<p class="o1" style="margin:0 0 .6rem;font-weight:700;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">Best: stage ${fmtComma(best)} · you're on ${fmtComma(cp)} · top ever ${fmtComma(S.top || best)}<button class="btn g-blue o1" data-act="goto" data-n="1" style="padding:.15rem .7rem;font-size:.95rem">🏠 Plaza</button>${cp < best ? `<button class="btn g-green o1" data-act="goto" data-n="${best}" style="padding:.15rem .7rem;font-size:.95rem">⬆️ Best (${best})</button>` : ''}</p><div class="stgrid">` + list.map((n) => {
            const Z = zoneOf(n), on = n === cp, sm = isSummit(n);
            return `<button class="stb o1${on ? ' on' : ''}${sm ? ' sm' : ''}" data-act="goto" data-n="${n}" style="--zc:${hex(Z.led)}">${sm ? '🏆' : ''}${n}</button>`;
        }).join('') + '</div>';
        return frame('Stages', '🗼', body, { w: 40, foot: 'Tap a landing to go back to it. Every 10th stage is a Summit: a Win and Gems. ' + skyOf(best).name + ' is where you are.' });
    },
    quests() {
        const Q = QUESTS[S.qi];
        let body = '';
        if (Q) {
            const p = Math.min(Q.n, S.qv || 0), ready = p >= Q.n;
            body += `<div class="row${ready ? ' feat' : ''}"><div class="ri"><span class="ci" style="font-size:2.4rem">🎯</span></div><div class="rt"><small style="color:#7af4ff;font-weight:700">QUEST ${S.qi + 1} / ${QUESTS.length}</small><b class="o1">${esc(Q.text)}</b><div class="prog"><i style="width:${(p / Q.n * 100).toFixed(0)}%"></i></div><em>${fmt(p)} / ${fmt(Q.n)} · Reward: ${rewardText(rewardFor(S, Q))}</em></div><div class="rb"><button class="btn ${ready ? 'g-green' : 'g-grey'} o" data-act="qclaim" ${ready ? '' : 'disabled'}>Claim</button></div></div>`;
        } else body += '<div class="row"><div class="rt"><b>🏆 Every quest done! Nobody climbs like you.</b></div></div>';
        body += `<h3 style="margin:.9rem 0 .4rem">🔥 Daily Tasks <small data-t="day" style="opacity:.75;font-size:.85rem">Resets in ${clock(dayLeft(net.now()))}</small></h3>`;
        body += ((S.jq && S.jq.list) || []).map((q, i) => {
            const T = TASKS[q.k], done = q.p >= T.n;
            return `<div class="row"><div class="ri"><span class="ci" style="font-size:2.2rem">${T.icon}</span></div><div class="rt"><b class="o1">${esc(T.text)}</b><div class="prog"><i style="width:${Math.min(100, q.p / T.n * 100).toFixed(0)}%"></i></div><em>${fmt(q.p)} / ${fmt(T.n)} · ${rewardText(rewardFor(S, T))}</em></div><div class="rb"><button class="btn ${done && !q.c ? 'g-green' : 'g-grey'} o" data-act="tclaim" data-i="${i}" ${done && !q.c ? '' : 'disabled'}>${q.c ? 'Done ✓' : 'Claim'}</button></div></div>`;
        }).join('');
        return frame('Quests', IC('quest'), body);
    },
    daily() {
        const st = dailyStatus(S.daily, net.now());
        const ic = (r) => (r.gems && !r.stages ? '💎' : r.spins ? '<i class="spinIc"></i>' : r.x2 ? '⚡' : CC);
        const days = DAILY.map((r, i) => `<div class="day${i === 6 ? ' big' : ''}${i < st.day ? ' got' : ''}${i === st.day && st.can ? ' now' : ''}"><span class="o1">DAY ${i + 1}</span><span class="di">${i < st.day ? '✅' : ic(r)}</span><span class="o1">${rewardText(rewardFor(S, r))}</span></div>`).join('');
        const body = `<div class="days">${days}</div><div style="text-align:center;margin-top:1rem"><button class="btn ${st.can ? 'g-green' : 'g-grey'} o" data-act="daily" ${st.can ? '' : 'disabled'} ${st.can ? '' : 'data-t="daily"'} style="min-width:12rem;height:3rem;font-size:1.4rem">${st.can ? 'Claim Day ' + (st.day + 1) : 'Next reward in ' + clock(dayLeft(net.now()))}</button></div>`;
        return frame('Daily Rewards', IC('gift'), body, { w: 44, foot: 'Come back every day: the rewards grow for 7 days in a row.' });
    },
    gifts() {
        const secs = sessionSecs();
        const body = GIFTS.map((g, i) => {
            const left = g.min * 60 - secs, got = S.gifts[i];
            return `<div class="row"><div class="ri"><span class="ci" style="font-size:2.4rem">${got ? '✅' : '🎁'}</span></div><div class="rt"><b class="o1">${rewardText(rewardFor(S, g))}</b><small>After ${g.min} minutes of play</small></div><div class="rb"><button class="btn ${!got && left <= 0 ? 'g-green' : 'g-grey'} o" data-act="gift" data-i="${i}" ${!got && left <= 0 ? '' : 'disabled'}>${got ? 'Claimed' : left <= 0 ? 'Claim!' : clock(left)}</button></div></div>`;
        }).join('');
        return frame('FREE Gifts', IC('gift'), body, { w: 34, foot: 'Gifts unlock the longer you play this session.' });
    },
    ranks() {
        const b = actions.boards ? actions.boards() : { top: [], time: [] };
        const hm = (s) => { const m = Math.floor(s / 60); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; };
        const col = (title, rows, f) => `<div><h3 style="margin:.2rem 0 .5rem">${title}</h3>${(rows || []).map((r, i) => `<div class="row" style="padding:.35rem .6rem;margin-bottom:.3rem"><b style="width:2rem">${['🥇', '🥈', '🥉'][i] || i + 1}</b><div class="rt"><b style="font-size:1rem">${esc(r.n)}</b></div><b>${f(r.v)}</b></div>`).join('') || '<p>Be the first!</p>'}</div>`;
        const full = actions.canOpenBoards && actions.canOpenBoards() ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.8rem">${LEADERBOARDS.map((L) => `<button class="btn g-blue o1" data-act="lb" data-id="${L.id}" style="padding:.25rem .8rem;font-size:1rem">${esc(L.label)}</button>`).join('')}</div>` : '';
        const body = `<p class="o1" style="margin:0 0 .6rem;font-weight:700">You: stage ${fmtComma(S.top || 1)} · ${fmtComma(S.wins || 0)} Wins · ${hm(S.playtime || 0)} played</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:1rem">${col('🗼 Highest Climbers', b.top, (v) => 'Stage ' + fmtComma(v))}${col('⏱️ Most Time Played', b.time, hm)}</div>${full}`;
        return frame('Leaderboards', '🏆', body);
    },
    settings() {
        const v = getVolumes(), q = getQuality();
        const body = `<div class="vol"><span>Graphics</span><div class="qbtns">${['low', 'medium', 'high'].map((k) => `<button class="btn g-blue o${q === k ? ' on' : ''}" data-act="quality" data-q="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
            <div class="vol"><span>Music</span><input type="range" min="0" max="100" value="${Math.round(v.music * 100)}" data-vol="music"></div>
            <div class="vol"><span>Key sounds</span><input type="range" min="0" max="100" value="${Math.round((v.asmr ?? 0.9) * 100)}" data-vol="asmr"></div>
            <div class="vol"><span>Effects</span><input type="range" min="0" max="100" value="${Math.round(v.sfx * 100)}" data-vol="sfx"></div>
            <div class="vol"><span>Show FPS</span><div class="qbtns"><button class="btn g-grey o" data-act="fps">${actions.fpsOn && actions.fpsOn() ? 'On' : 'Off'}</button></div></div>
            <div class="vol"><span>Stuck?</span><div class="qbtns"><button class="btn g-blue o" data-act="home">Back to my checkpoint</button></div></div>
            <p style="margin:1rem 0 0;font-weight:600;opacity:.8">${isTouch ? 'Stick to move · hold JUMP to keep hopping · tap a tool on the hotbar · drag to look around.' : 'WASD move · SPACE jump (hold to keep hopping) · click or F bonk · 1-4 tools · [ ] stages · R checkpoint · E use · drag to look'}</p>`;
        return frame('Settings', IC('gear'), body, { w: 36 });
    },
};

// =====================================================================================
// What the buttons do
// =====================================================================================
function doAct(act, d) {
    sfx('click');
    switch (act) {
        case 'spin':
            if (S.spins > 0 && !spinning) {
                spinning = true; net.send('spin', {}); renderSpinButton();
                clearTimeout(spinWait); spinWait = setTimeout(() => { if (spinning) { spinning = false; refreshPanels(); } }, 4000);
            }
            break;
        case 'restack': {
            const need = restackNeed(S.restacks);
            if ((S.best || 1) < need) { toast('🔁 Restack opens at stage ' + need, '#ff9a8a'); sfx('denied'); break; }
            askConfirm('🔁', 'Restack?', 'Back to stage 1, your Coins back to nothing. Every coin pays x' + stackMult((S.restacks || 0) + 1) + ' from now on, and you get ' + restackGems(S.restacks) + ' 💎.', 'RESTACK!', () => { closePanel(); net.send('restack', {}); });
            break;
        }
        case 'goto': closePanel(); if (actions.goto) actions.goto(+d.n); break;
        case 'openbox': openPanel('box', d.id); break;
        case 'pack': net.send('pack', { id: d.id }); break;
        case 'x2': net.send('x2', {}); break;
        case 'item': { const it = itemById[d.id]; if (it) askConfirm(it.icon, it.name, esc(it.text), price(it), () => net.send('item', { id: d.id })); break; }
        case 'trail': net.send('trail', { id: d.id }); break;
        case 'code': { const v = ($('#codeIn') || {}).value || ''; if (v.trim()) net.send('code', { code: v.trim() }); break; }
        case 'qclaim': net.send('qclaim', {}); break;
        case 'tclaim': net.send('tclaim', { i: +d.i }); break;
        case 'daily': net.send('daily', {}); break;
        case 'gift': net.send('gift', { i: +d.i }); break;
        case 'quality': setQuality(d.q); if (actions.saveSetting) actions.saveSetting({ graphics_quality: d.q === 'low' ? 'Low' : d.q === 'medium' ? 'Medium' : 'High' }); renderPanel(); break;
        case 'fps': if (actions.toggleFps) actions.toggleFps(); if (actions.saveSetting && actions.fpsOn) actions.saveSetting({ show_fps: actions.fpsOn() }); renderPanel(); break;
        case 'home': closePanel(); if (actions.respawn) actions.respawn(); break;
        case 'upgrade': net.send('upgrade', { id: d.id }); break;
        case 'equip': net.send('equip', { id: d.id }); sfx('equip'); break;
        case 'unequip': net.send('equip', { id: d.id, off: 1 }); break;
        case 'equipbest': net.send('equipbest', {}); sfx('equip'); break;
        case 'hatch': if (actions.hatch) actions.hatch(panelArg, +d.n); break;
        case 'lb': if (actions.openBoard) actions.openBoard(d.id); break;
    }
}
function renderSpinButton() { const b = $('#modal').querySelector('[data-act="spin"]'); if (b) b.disabled = true; }
// the wheel's answer: turn to the prize, then show it
let spinWait = 0;
export function onSpun(m) {
    clearTimeout(spinWait);
    const seg = 360 / SPIN.length, target = -((m.i + 0.5) * seg) + (Math.random() - 0.5) * seg * 0.6;
    const base = wheelAngle + 360 * 5;
    wheelAngle = base + ((((target - base) % 360) + 360) % 360);
    const el = $('#wheel');
    spinning = true;
    if (el) { el.style.transition = 'transform 3.4s cubic-bezier(0.15, 0.85, 0.25, 1)'; el.style.transform = 'rotate(' + wheelAngle.toFixed(1) + 'deg)'; }
    let ticks = 0;
    const tick = () => { if (ticks++ < 22) { sfx('click'); setTimeout(tick, 40 + ticks * ticks * 0.35); } };
    tick();
    setTimeout(() => {
        spinning = false;
        sfx('reward');
        popup('🎡', 'YOU WON!', m.text, '#ffe24a', true);
        if (panelKind === 'spin') renderPanel();
    }, el ? 3500 : 50);
}
// a yes / no question (yes may hold html: the drawn icons)
export function askConfirm(icon, title, text, yes, act) {
    const c = $('#confirm');
    c.innerHTML = `<div class="panel"><header><h2 class="o">${title}</h2><div class="hx"><button class="btn g-red o x" data-no>✕</button></div></header><div></div><div class="cbody"><span class="bi">${icon}</span><p>${text}</p><div class="btns"><button class="btn g-green o" data-yes>${yes}</button><button class="btn g-grey o" data-no>Cancel</button></div></div><div></div></div>`;
    c.hidden = false;
    for (const b of c.querySelectorAll('[data-no]')) b.onclick = () => { c.hidden = true; sfx('close'); };
    c.querySelector('[data-yes]').onclick = () => { c.hidden = true; act(); };
    c.onclick = (e) => { if (e.target === c) c.hidden = true; };
}
export function closeTop() {
    if (!$('#hatch').hidden) { closeHatch(); return true; }
    if (!$('#confirm').hidden) { $('#confirm').hidden = true; return true; }
    if (!$('#summit').hidden) { $('#summit').hidden = true; if (actions.onSummitClosed) actions.onSummitClosed(); return true; }
    if (closePanel()) return true;
    return false;
}
export const anyPopup = () => !$('#modal').hidden || !$('#confirm').hidden || !$('#hatch').hidden || !$('#summit').hidden;
// the panels with their real content, for the loading warm-up; returns the clean-up
export function warmPanels() {
    const m = $('#modal');
    panelKind = 'spin'; panelArg = 'c1';
    const tabs = ['up', 'gear', 'trails', 'gems', 'codes'].map((t) => { panelTab = t; return PANELS.shop(); }).join('');
    panelTab = null;
    m.innerHTML = PANELS.spin() + PANELS.restack() + PANELS.daily() + PANELS.quests() + tabs + PANELS.pals() + PANELS.box() + PANELS.gifts() + PANELS.ranks() + PANELS.settings() + PANELS.stages();
    m.hidden = false; m.classList.add('warmui');
    $('#confirm').innerHTML = '<div class="panel"><header><h2 class="o">Buy?</h2></header><div></div><div class="cbody"><span class="bi">🪙</span><p>Sample</p><div class="btns"><button class="btn g-green o">Yes</button></div></div><div></div></div>';
    $('#confirm').hidden = false; $('#confirm').classList.add('warmui');
    popup('⭐', 'SUMMIT!', 'Sample', '#ffe24a'); $('#popup').classList.add('warmui');
    summitCard({ n: 11, got: 120, gems: 3, wins: 1, zone: 'Peach Fizz', sky: 'Morning Meadow' }); $('#summit').classList.add('warmui');
    toast('Sample', '#ffffff');
    const H = $('#hatch'), C = $('#hatchCaps');
    C.innerHTML = '<div class="hc"><div class="cap" style="--cc:#ff9ad6"></div></div><div class="hc"><img src="' + buddyIcon(BUDDIES[0].id) + '" alt=""><b class="o">Clicky</b><small class="o1">Common</small></div>';
    H.hidden = false; H.classList.add('warmui');
    return () => {
        for (const s of ['#modal', '#confirm', '#popup', '#hatch', '#summit']) { $(s).classList.remove('warmui'); $(s).hidden = true; }
        clearTimeout(summitCard.t); actions.onSummitClosed = null;
        m.innerHTML = ''; $('#confirm').innerHTML = ''; panelKind = null; $('#toasts').innerHTML = ''; C.innerHTML = '';
    };
}
