// Local mirror of this player's progress. The server owns the real values: everyone's position arrives through the room state,
// private progress in "profile" messages (and "lite" ones while you climb).
export const S = {
    coins: 0, gems: 0, wins: 0, best: 1, top: 1, cp: 1, restacks: 0, totalCoins: 0,
    pickups: 0, summits: 0, bounces: 0, bonks: 0, caps: 0,
    ups: {}, upgrades: 0, items: { glove: 1 }, trail: '', trails: {}, buds: {}, team: [], index: {}, spins: 0, spinIn: 0, spinsUsed: 0, x2Until: 0,
    qi: 0, qv: 0, jq: { day: '', list: [] }, daily: {}, codes: {}, gifts: {}, seen: {}, tut: 0,
    sessionSecs: 0, playtime: 0, firstPlay: Date.now(),
    joinedAt: Date.now(), profileAt: 0, name: '',
    // this device only: the Cloud Carpet on or off
    carpetOn: true,
};

// Game actions that world objects and panels trigger; filled in by main.js / ui.js
export const actions = {};

export const net = {
    room: null,
    offset: 0,
    rtt: 0,
    send(type, msg) { if (this.room) this.room.send(type, msg || {}); },
    // Server clock in ms (corrected for the round trip, smooth.js), so timers line up for everyone
    fixedNow: null,
    now() { return this.fixedNow ?? Date.now() + this.offset; },
};

// QA: where a slow frame's time went (sections marked as the frame runs)
export const prof = { t: 0, parts: [], on: true, mark(name) { const n = performance.now(); this.parts.push(name, n - this.t); this.t = n; }, start() { this.parts.length = 0; this.t = performance.now(); } };
