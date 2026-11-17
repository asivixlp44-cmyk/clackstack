import { schema, t } from '@colyseus/schema';

// Public, synced to every client: the server's clock, everyone on the tower, the Rainbow Rush. Private progress (Coins, Gems, quests...)
// goes only to its owner in "profile" / "lite". Positions carry a server-time stamp (t): other clients smooth them on that timeline.
export const PlayerState = schema({
    name: t.string().default(''),
    pid: t.uint8().default(0),
    bx: t.string().default(''),      // their Boxity account id (chat bubbles find them by it); '' for a guest or a bot
    bot: t.boolean().default(false),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    ry: t.float32().default(0),
    t: t.float64().default(0),       // when they were there (server ms)
    anim: t.uint8().default(0),      // 0 idle, 1 walk, 2 air, 3 gliding on the Cloud Carpet
    title: t.string().default(''),
    top: t.uint16().default(1),      // their highest stage ever (the name tag)
    cp: t.uint16().default(1),       // the landing they're climbing from (the tower gauge)
    wins: t.uint32().default(0),
    team: t.string().default(''),    // their Pals, comma separated
    trail: t.string().default(''),   // their trail's id
    av: t.string().default(''),      // packed Bloxity avatar (equipped ids + proportions)
}, 'PlayerState');

export const GameState = schema({
    now: t.float64().default(0),     // the server's clock, every patch
    rush: t.float64().default(0),    // RAINBOW RUSH until then (server ms; 0: none)
    players: t.map(PlayerState),
}, 'GameState');
