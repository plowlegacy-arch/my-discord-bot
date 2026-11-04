// Career definitions. Each career has levels with salaries, XP requirements,
// cooldowns and unlockable rewards. Nothing here is cosmetic: /work resolves
// against these tables and pays out through the atomic ledger.

export const CAREERS = {
  miner: {
    name: 'Miner', emoji: '⛏', base: 180, growth: 1.34, cooldown: 3600,
    levels: [
      { title: 'Pebble Picker', unlock: 'coal' },
      { title: 'Shaft Hand', unlock: 'iron' },
      { title: 'Drill Operator', unlock: 'quartz' },
      { title: 'Vein Specialist', unlock: 'gold' },
      { title: 'Blast Foreman', unlock: 'diamond' },
      { title: 'Deep Core Master', unlock: 'obsidian' },
      { title: 'Trench Baron', unlock: 'singularity' },
    ],
  },
  fisherman: {
    name: 'Fisherman', emoji: '🎣', base: 150, growth: 1.3, cooldown: 2700,
    levels: [
      { title: 'Dock Hand', unlock: 'minnow' },
      { title: 'Line Caster', unlock: 'bass' },
      { title: 'Net Runner', unlock: 'salmon' },
      { title: 'Deep Angler', unlock: 'swordfish' },
      { title: 'Trawler Captain', unlock: 'anglerfish' },
      { title: 'Kraken Hunter', unlock: 'kraken' },
      { title: 'Abyss Legend', unlock: 'leviathan' },
    ],
  },
  hunter: {
    name: 'Hunter', emoji: '🏹', base: 165, growth: 1.32, cooldown: 3000,
    levels: [
      { title: 'Trapper', unlock: 'hide' },
      { title: 'Scout', unlock: 'antler' },
      { title: 'Stalker', unlock: 'fang' },
      { title: 'Beast Slayer', unlock: 'pelt' },
      { title: 'Apex Predator', unlock: 'meteorite' },
    ],
  },
  farmer: {
    name: 'Farmer', emoji: '🌾', base: 130, growth: 1.26, cooldown: 2400,
    levels: [
      { title: 'Field Hand', unlock: null },
      { title: 'Grower', unlock: null },
      { title: 'Harvest Lead', unlock: null },
      { title: 'Estate Owner', unlock: null },
      { title: 'Agri Magnate', unlock: null },
    ],
  },
  business_owner: {
    name: 'Business Owner', emoji: '💼', base: 240, growth: 1.4, cooldown: 3600,
    levels: [
      { title: 'Kiosk Owner', unlock: null },
      { title: 'Shop Owner', unlock: null },
      { title: 'Chain Operator', unlock: null },
      { title: 'Consortium Head', unlock: null },
      { title: 'Tycoon', unlock: null },
    ],
  },
  delivery: {
    name: 'Delivery Driver', emoji: '📦', base: 145, growth: 1.28, cooldown: 1800,
    levels: [
      { title: 'Courier', unlock: null },
      { title: 'Route Driver', unlock: null },
      { title: 'Fleet Lead', unlock: null },
      { title: 'Logistics Chief', unlock: null },
    ],
  },
  programmer: {
    name: 'Programmer', emoji: '💻', base: 205, growth: 1.38, cooldown: 4200,
    levels: [
      { title: 'Junior Dev', unlock: null },
      { title: 'Engineer', unlock: null },
      { title: 'Senior Engineer', unlock: null },
      { title: 'Staff Engineer', unlock: null },
      { title: 'Principal', unlock: null },
      { title: 'CTO', unlock: null },
    ],
  },
  trader: {
    name: 'Trader', emoji: '📈', base: 190, growth: 1.45, cooldown: 5400,
    levels: [
      { title: 'Paper Hands', unlock: null },
      { title: 'Scalper', unlock: null },
      { title: 'Swing Trader', unlock: null },
      { title: 'Desk Trader', unlock: null },
      { title: 'Fund Manager', unlock: null },
      { title: 'Market Maker', unlock: null },
    ],
  },
  detective: {
    name: 'Detective', emoji: '🕵', base: 210, growth: 1.36, cooldown: 4800,
    levels: [
      { title: 'Rookie', unlock: null },
      { title: 'Investigator', unlock: null },
      { title: 'Inspector', unlock: null },
      { title: 'Chief Detective', unlock: null },
    ],
  },
  engineer: {
    name: 'Engineer', emoji: '🛠', base: 220, growth: 1.37, cooldown: 4800,
    levels: [
      { title: 'Apprentice', unlock: null },
      { title: 'Field Engineer', unlock: null },
      { title: 'Systems Engineer', unlock: null },
      { title: 'Lead Engineer', unlock: null },
    ],
  },
  builder: {
    name: 'Builder', emoji: '🏗', base: 160, growth: 1.29, cooldown: 2700,
    levels: [
      { title: 'Laborer', unlock: null },
      { title: 'Framer', unlock: null },
      { title: 'Site Lead', unlock: null },
      { title: 'General Contractor', unlock: null },
    ],
  },
  doctor: {
    name: 'Doctor', emoji: '🩺', base: 275, growth: 1.42, cooldown: 5400,
    levels: [
      { title: 'Intern', unlock: null },
      { title: 'Resident', unlock: null },
      { title: 'Attending', unlock: null },
      { title: 'Surgeon', unlock: null },
      { title: 'Chief of Medicine', unlock: null },
    ],
  },
  mechanic: {
    name: 'Mechanic', emoji: '🔧', base: 155, growth: 1.3, cooldown: 2400,
    levels: [
      { title: 'Lube Tech', unlock: null },
      { title: 'Line Mechanic', unlock: null },
      { title: 'Master Tech', unlock: null },
      { title: 'Shop Owner', unlock: null },
    ],
  },
};

export const careerList = () => Object.entries(CAREERS).map(([key, c]) => ({
  key, name: c.name, emoji: c.emoji, cooldown: c.cooldown,
  level: 1, levels: c.levels.length, start_salary: c.base,
}));

export function careerLevelInfo(key, level = 1) {
  const career = CAREERS[key];
  if (!career) return null;
  const idx = Math.max(0, Math.min(career.levels.length - 1, level - 1));
  const tier = career.levels[idx];
  const salary = Math.round(career.base * career.growth ** idx);
  const nextAt = 100 * idx * (idx + 1); // career xp needed for next tier
  return {
    key, level: idx + 1, max_level: career.levels.length, title: tier.title, unlock: tier.unlock,
    salary, cooldown: career.cooldown, next_at: idx + 1 < career.levels.length ? nextAt : null,
    is_max: idx + 1 >= career.levels.length,
  };
}

/** Randomized interactive work scenario; choices bias payout/risk. */
const SCENARIOS = [
  { text: 'You spot an unusually rich vein but it sits under unstable rock.', choices: [
    { label: 'Mine it carefully', mult: 1.25, risk: 0.15 },
    { label: 'Play it safe nearby', mult: 1, risk: 0 },
  ] },
  { text: 'A stranger offers to buy your haul at a premium, cash upfront.', choices: [
    { label: 'Take the deal', mult: 1.35, risk: 0.22 },
    { label: 'Wait for market price', mult: 1.05, risk: 0.05 },
  ] },
  { text: 'Your equipment starts overheating mid-shift.', choices: [
    { label: 'Push through the shift', mult: 1.3, risk: 0.3 },
    { label: 'Shut down and repair', mult: 0.85, risk: 0 },
  ] },
  { text: 'A coworker asks you to cover their shift for a cut.', choices: [
    { label: 'Cover the shift', mult: 1.15, risk: 0.08 },
    { label: 'Decline and go home', mult: 1, risk: 0 },
  ] },
  { text: 'Management offers a bonus for a flawless deliverable.', choices: [
    { label: 'Chase the bonus', mult: 1.45, risk: 0.35 },
    { label: 'Deliver normal quality', mult: 1, risk: 0 },
  ] },
];

export function workScenario(level, rng = Math.random) {
  const base = SCENARIOS[Math.floor(rng() * SCENARIOS.length)];
  return {
    text: base.text,
    choices: base.choices.map((c) => ({ ...c, payout_hint: c.mult })),
    quality: 0.9 + rng() * 0.2,
    level,
  };
}

export function resolveWork({ career, level, choiceIndex, rng = Math.random }) {
  const info = careerLevelInfo(career, level);
  if (!info) throw new Error('unknown career');
  const scenario = workScenario(level, rng);
  const choice = scenario.choices[Math.min(choiceIndex, scenario.choices.length - 1)];
  const failed = rng() < choice.risk;
  const payout = failed ? Math.round(info.salary * 0.25) : Math.round(info.salary * choice.mult);
  const xp = failed ? 4 : 8 + level * 2;
  return { info, payout, xp, failed, scenario, choice: choice.label };
}

export function promotionCheck(careerXp, level) {
  const info = careerLevelInfo(career, level);
  if (!info || info.next_at == null) return { promoted: false, info };
  if (careerXp >= info.next_at) {
    return { promoted: true, next: careerLevelInfo(career, level + 1) };
  }
  return { promoted: false, info };
}
