import { roll, ITEMS, rarityOf } from './items.js';

// Activities: mining, fishing, hunting, treasure, exploration, daily missions.
// Outcomes are decided here (pure), balances are mutated by the caller through
// the atomic ledger so an activity can never partially pay out.

export const ACTIVITIES = {
  mine: { key: 'mine', name: 'Mining', emoji: '⛏', cooldown: 300, xp: 12, cash: [60, 240], source: 'mining' },
  fish: { key: 'fish', name: 'Fishing', emoji: '🎣', cooldown: 240, xp: 10, cash: [50, 200], source: 'fishing' },
  hunt: { key: 'hunt', name: 'Hunting', emoji: '🏹', cooldown: 360, xp: 14, cash: [70, 260], source: 'hunting' },
  treasure: { key: 'treasure', name: 'Treasure Hunting', emoji: '🗝', cooldown: 900, xp: 22, cash: [120, 900], source: 'treasure' },
  explore: { key: 'explore', name: 'Exploration', emoji: '🧭', cooldown: 600, xp: 16, cash: [80, 400], source: 'explore' },
};

const FLAVOR = {
  mine: ['You descend into the old trench shaft.', 'A fresh seam opens after the blast.', 'Dust clears over the drill rig.'],
  fish: ['The water is glassy this morning.', 'Something heavy takes the line.', 'A quiet cast off the pier.'],
  hunt: ['You follow tracks into the ridge.', 'The forest goes silent.', 'Wind shifts across the clearing.'],
  treasure: ['The map leads to a collapsed cellar.', 'You dig where the signal spikes.', 'A rusted lock gives way.'],
  explore: ['You chart an unmapped tunnel.', 'A side passage smells of old air.', 'The compass spins once, then settles.'],
};

export function rollActivity(key, { luck = 0, rng = Math.random } = {}) {
  const act = ACTIVITIES[key];
  if (!act) throw new Error('unknown activity');
  const cash = Math.round(act.cash[0] + rng() * (act.cash[1] - act.cash[0]));
  const found = roll(act.source, luck, rng);
  const doubled = rng() < 0.06 + luck * 0.1;
  const rarity = rarityOf(found.key);
  return {
    activity: act.key,
    name: act.name,
    emoji: act.emoji,
    flavor: FLAVOR[act.key][Math.floor(rng() * 3)],
    cash: doubled ? cash * 2 : cash,
    item: { key: found.key, ...ITEMS[found.key] },
    rarity,
    bonus: doubled,
    xp: act.xp,
    cooldown: act.cooldown,
  };
}

/** Daily missions — deterministic per user/day so progress is verifiable. */
const MISSION_POOL = [
  { key: 'work_once', label: 'Complete one shift', target: 1, reward: 400, kind: 'work' },
  { key: 'mine_twice', label: 'Mine twice', target: 2, reward: 350, kind: 'mine' },
  { key: 'fish_three', label: 'Catch three things', target: 3, reward: 320, kind: 'fish' },
  { key: 'gamble_once', label: 'Place a casino bet', target: 1, reward: 500, kind: 'casino' },
  { key: 'trade_once', label: 'Buy or sell on the marketplace', target: 1, reward: 380, kind: 'market' },
  { key: 'hunt_once', label: 'Go on a hunt', target: 1, reward: 300, kind: 'hunt' },
  { key: 'explore_once', label: 'Explore a new region', target: 1, reward: 330, kind: 'explore' },
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

export function dailyMissions(userId, dayKey, count = 3) {
  const seed = hash(`${userId}:${dayKey}`);
  const picked = [];
  let x = seed;
  while (picked.length < count) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const m = MISSION_POOL[x % MISSION_POOL.length];
    if (!picked.find((p) => p.key === m.key)) picked.push(m);
  }
  return picked;
}

export const ACHIEVEMENTS = {
  first_work: { name: 'First Shift', desc: 'Complete your first job shift', reward: 250 },
  first_kill: { name: 'Strike One', desc: 'Win your first casino bet', reward: 250 },
  rich_100k: { name: 'Six Figures', desc: 'Reach a 100,000 net worth', reward: 5000 },
  rich_1m: { name: 'Trench Whale', desc: 'Reach a 1,000,000 net worth', reward: 50000 },
  legendary_find: { name: 'Legendary Find', desc: 'Discover a legendary item', reward: 3000 },
  mythical_find: { name: 'Mythical Find', desc: 'Discover a mythical item', reward: 15000 },
  business_owner: { name: 'Owner Operator', desc: 'Own your first business', reward: 1000 },
  married: { name: 'Two of a Kind', desc: 'Marry another member', reward: 1500 },
  level_10: { name: 'Seasoned', desc: 'Reach level 10', reward: 2000 },
};
