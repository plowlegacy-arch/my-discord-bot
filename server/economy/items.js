// Item catalogue: rarity tiers drive rewards, marketplace pricing and embed colour.
export const RARITY = {
  common: { key: 'common', label: 'Common', color: 0x8b9aa8, weight: 520, value: 120 },
  uncommon: { key: 'uncommon', label: 'Uncommon', color: 0x4ade80, weight: 260, value: 420 },
  rare: { key: 'rare', label: 'Rare', color: 0x38bdf8, weight: 140, value: 1600 },
  epic: { key: 'epic', label: 'Epic', color: 0x14e0a0, weight: 58, value: 6400 },
  legendary: { key: 'legendary', label: 'Legendary', color: 0xfbbf24, weight: 18, value: 24000 },
  mythical: { key: 'mythical', label: 'Mythical', color: 0xf472b6, weight: 3.4, value: 90000 },
  secret: { key: 'secret', label: 'Secret', color: 0xf43f5e, weight: 0.6, value: 320000 },
};

export const ITEMS = {
  // mining
  coal: { name: 'Coal Chunk', emoji: '🪨', rarity: 'common', value: 90, sources: ['mining'] },
  iron: { name: 'Iron Ore', emoji: '⛏', rarity: 'common', value: 140, sources: ['mining'] },
  quartz: { name: 'Quartz Shard', emoji: '🔷', rarity: 'uncommon', value: 480, sources: ['mining'] },
  gold: { name: 'Gold Nugget', emoji: '🟡', rarity: 'rare', value: 1700, sources: ['mining'] },
  emerald: { name: 'Emerald Cluster', emoji: '💚', rarity: 'rare', value: 2350, sources: ['mining'] },
  diamond: { name: 'Diamond', emoji: '💎', rarity: 'epic', value: 6800, sources: ['mining'] },
  obsidian: { name: 'Void Obsidian', emoji: '🖤', rarity: 'legendary', value: 26000, sources: ['mining'] },
  meteorite: { name: 'Meteorite Core', emoji: '☄️', rarity: 'mythical', value: 98000, sources: ['mining', 'treasure'] },
  singularity: { name: 'Singularity Fragment', emoji: '🌌', rarity: 'secret', value: 350000, sources: ['mining'] },
  // fishing
  minnow: { name: 'Minnow', emoji: '🐟', rarity: 'common', value: 80, sources: ['fishing'] },
  bass: { name: 'Bass', emoji: '🐠', rarity: 'common', value: 130, sources: ['fishing'] },
  salmon: { name: 'Salmon', emoji: '🍣', rarity: 'uncommon', value: 460, sources: ['fishing'] },
  swordfish: { name: 'Swordfish', emoji: '🗡', rarity: 'rare', value: 1600, sources: ['fishing'] },
  anglerfish: { name: 'Anglerfish', emoji: '🎣', rarity: 'epic', value: 6200, sources: ['fishing'] },
  kraken: { name: 'Kraken Tentacle', emoji: '🐙', rarity: 'legendary', value: 22000, sources: ['fishing'] },
  leviathan: { name: 'Leviathan Scale', emoji: '🐉', rarity: 'mythical', value: 88000, sources: ['fishing'] },
  // hunting
  hide: { name: 'Raw Hide', emoji: '🟫', rarity: 'common', value: 100, sources: ['hunting'] },
  antler: { name: 'Antler', emoji: '🦌', rarity: 'uncommon', value: 500, sources: ['hunting'] },
  fang: { name: 'Predator Fang', emoji: '🦷', rarity: 'rare', value: 1900, sources: ['hunting'] },
  pelt: { name: 'Shadow Pelt', emoji: '🐺', rarity: 'epic', value: 7000, sources: ['hunting'] },
  // treasure / exploration
  coin_hoard: { name: 'Ancient Coin Hoard', emoji: '🪙', rarity: 'uncommon', value: 620, sources: ['treasure', 'explore'] },
  relic: { name: 'Lost Relic', emoji: '🏺', rarity: 'rare', value: 2400, sources: ['treasure', 'explore'] },
  crown: { name: 'Sunken Crown', emoji: '👑', rarity: 'legendary', value: 31000, sources: ['treasure'] },
  map_fragment: { name: 'Map Fragment', emoji: '🗺', rarity: 'secret', value: 150000, sources: ['travel', 'explore'] },
  // equipment / assets
  pickaxe: { name: 'Reinforced Pickaxe', emoji: '⛏', rarity: 'rare', value: 3200, sources: ['shop'], kind: 'equipment', effect: { mining: 0.15 } },
  rod: { name: 'Carbon Rod', emoji: '🎣', rarity: 'rare', value: 3200, sources: ['shop'], kind: 'equipment', effect: { fishing: 0.15 } },
  rifle: { name: 'Hunting Rifle', emoji: '🔫', rarity: 'rare', value: 3600, sources: ['shop'], kind: 'equipment', effect: { hunting: 0.18 } },
  detector: { name: 'Deep Detector', emoji: '📡', rarity: 'epic', value: 12000, sources: ['shop'], kind: 'equipment', effect: { treasure: 0.25, explore: 0.2 } },
  penthouse: { name: 'Penthouse', emoji: '🏙', rarity: 'legendary', value: 400000, sources: ['shop'], kind: 'house' },
  cabin: { name: 'Timber Cabin', emoji: '🏡', rarity: 'rare', value: 90000, sources: ['shop'], kind: 'house' },
  supercar: { name: 'Hypercar', emoji: '🏎', rarity: 'epic', value: 180000, sources: ['shop'], kind: 'vehicle' },
  motorcycle: { name: 'Cafe Racer', emoji: '🏍', rarity: 'uncommon', value: 26000, sources: ['shop'], kind: 'vehicle' },
  // collectibles
  card_alpha: { name: 'Alpha Card #001', emoji: '🃏', rarity: 'legendary', value: 55000, sources: ['shop', 'collect'], limited: 50 },
  pin: { name: 'Trench Pin', emoji: '📌', rarity: 'common', value: 300, sources: ['collect', 'shop'] },
  lantern: { name: 'Signal Lantern', emoji: '🏮', rarity: 'uncommon', value: 900, sources: ['collect'] },
};

export const itemByKey = (key) => (ITEMS[key] ? { key, ...ITEMS[key] } : null);
export const itemValue = (key, qty = 1) => (ITEMS[key]?.value ?? 0) * qty;
export const rarityOf = (key) => RARITY[ITEMS[key]?.rarity] || RARITY.common;

/** Weighted random pick from a source pool. */
export function roll(source, luck = 0, rng = Math.random) {
  const pool = Object.entries(ITEMS).filter(([, it]) => it.sources?.includes(source) && it.kind !== 'house' && it.kind !== 'vehicle' && !it.limited);
  const weights = pool.map(([key, it]) => {
    const base = RARITY[it.rarity]?.weight ?? 1;
    // luck shifts weight toward higher rarities
    const tier = Object.values(RARITY).indexOf(RARITY[it.rarity]);
    return base * (1 + luck * tier * 0.35);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return { key: pool[i][0], ...pool[i][1] };
  }
  return { key: pool[0][0], ...pool[0][1] };
}

export const shopItems = () => Object.entries(ITEMS)
  .filter(([, it]) => it.sources?.includes('shop'))
  .map(([key, it]) => ({ key, ...it, price: Math.round(it.value * 1.35) }));
