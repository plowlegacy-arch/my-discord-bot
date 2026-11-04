import crypto from 'node:crypto';
import { db, now } from '../db.js';
import { getGuild, getUser, debit, credit, logTx } from './store.js';

// Casino engine. Every game resolves to a pure outcome here, then money moves
// through the atomic ledger: the wager is debited first and the payout credited
// once, so a duplicate interaction can never pay twice (guarded by wager debit).

const GAMES = {
  dice: { name: 'Dice', emoji: '🎲', edge: 0.99, max_win_mult: 100 },
  coinflip: { name: 'Coinflip', emoji: '🪙', edge: 0.98, max_win_mult: 2 },
  crash: { name: 'Crash', emoji: '📉', edge: 0.97 },
  roulette: { name: 'Roulette', emoji: '🎡', edge: 0.973 },
  blackjack: { name: 'Blackjack', emoji: '🃏', edge: 0.99, max_win_mult: 3 },
  mines: { name: 'Mines', emoji: '💣', edge: 0.99 },
  slots: { name: 'Slots', emoji: '🎰', edge: 0.96 },
  plinko: { name: 'Plinko', emoji: '🔻', edge: 0.97 },
  baccarat: { name: 'Baccarat', emoji: '🀄', edge: 0.988 },
};

export const GAME_ORDER = ['crash', 'roulette', 'blackjack', 'mines', 'slots', 'dice', 'coinflip', 'plinko', 'baccarat'];

export const gameList = () => Object.entries(GAMES).map(([key, g]) => ({ key, ...g }));

/* ---------------------------------------------------------------- fairness */

const hmac = (seed, message) => crypto.createHmac('sha256', seed).update(message).digest('hex');

export function startSeed(guildId, userId) {
  const gid = String(guildId);
  const uid = String(userId);
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
  const clientSeed = crypto.randomBytes(8).toString('hex');
  db.prepare(
    `INSERT INTO casino_seeds (guild_id, user_id, server_seed, server_seed_hash, client_seed, nonce, revealed)
     VALUES (?,?,?,?,?,0,0)
     ON CONFLICT(guild_id, user_id) DO NOTHING`,
  ).run(gid, uid, serverSeed, hash, clientSeed);
  return seedState(gid, uid);
}

export function seedState(guildId, userId) {
  const row = db.prepare('SELECT * FROM casino_seeds WHERE guild_id = ? AND user_id = ?')
    .get(String(guildId), String(userId));
  if (!row) return startSeed(guildId, userId);
  return {
    server_seed_hash: row.server_seed_hash,
    client_seed: row.client_seed,
    nonce: row.nonce,
    revealed: !!row.revealed,
    server_seed: row.revealed ? row.server_seed : null,
  };
}

/** Rotate: reveals the previous seed so the player can verify past results. */
export function rotateSeed(guildId, userId, newClientSeed = null) {
  const gid = String(guildId);
  const uid = String(userId);
  const prev = db.prepare('SELECT * FROM casino_seeds WHERE guild_id = ? AND user_id = ?').get(gid, uid);
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
  const clientSeed = (newClientSeed || crypto.randomBytes(8).toString('hex')).slice(0, 64);
  db.prepare(
    `INSERT INTO casino_seeds (guild_id, user_id, server_seed, server_seed_hash, client_seed, nonce, revealed)
     VALUES (?,?,?,?,?,0,0)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET server_seed=excluded.server_seed,
       server_seed_hash=excluded.server_seed_hash, client_seed=excluded.client_seed, nonce=0, revealed=0`,
  ).run(gid, uid, serverSeed, hash, clientSeed);
  return { previous: prev ? { server_seed: prev.server_seed, client_seed: prev.client_seed, nonce: prev.nonce } : null, current: seedState(gid, uid) };
}

/** Deterministic float in [0,1) for the next nonce, consuming the nonce. */
const floatTx = db.transaction((guildId, userId, count = 1) => {
  const gid = String(guildId);
  const uid = String(userId);
  let row = db.prepare('SELECT * FROM casino_seeds WHERE guild_id = ? AND user_id = ?').get(gid, uid);
  if (!row) { startSeed(gid, uid); row = db.prepare('SELECT * FROM casino_seeds WHERE guild_id = ? AND user_id = ?').get(gid, uid); }
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const nonce = row.nonce + i;
    const digest = hmac(row.server_seed, `${row.client_seed}:${nonce}`);
    // 32-bit ints from 8-byte groups → uniform float
    const int = parseInt(digest.slice(0, 13), 16);
    out.push({ value: int / 2 ** 52, nonce, hash: digest.slice(0, 16) });
  }
  db.prepare('UPDATE casino_seeds SET nonce = nonce + ? WHERE guild_id = ? AND user_id = ?').run(count, gid, uid);
  return out;
});

export function nextFloats(guildId, userId, count = 1) {
  return floatTx(guildId, userId, count);
}

/* ------------------------------------------------------------ game maths */

export const CRASH_HOUSE_EDGE = 0.03;

/** Crash point derived from a uniform float, with instant-bust chance. */
export function crashPoint(u) {
  const r = 1 / (1 - u); // pareto-ish tail
  const point = Math.max(1, (1 - CRASH_HOUSE_EDGE) * r);
  return Math.min(point, 1e6);
}

export function minesMultiplier(revealed, mines, total = 25) {
  if (revealed <= 0) return 1;
  let m = 1;
  for (let i = 0; i < revealed; i += 1) {
    m *= (total - i) / (total - mines - i);
  }
  return Math.round(m * 0.99 * 10000) / 10000;
}

export function plinkoBuckets(rows = 12) {
  const buckets = rows + 1;
  const probs = [];
  for (let i = 0; i < buckets; i += 1) {
    // binomial distribution of a left/right walk
    let c = 1;
    for (let k = 0; k < i; k += 1) c = (c * (rows - k)) / (k + 1);
    probs.push(c / 2 ** rows);
  }
  const mid = (buckets - 1) / 2;
  const mults = probs.map((p, i) => {
    const mult = Math.max(0.2, Math.round((0.97 / (buckets * p)) * 10) / 10);
    return i === Math.round(mid) ? Math.min(mult, 1.6) : mult;
  });
  return { probs, mults };
}

export const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function rouletteSpin(u) {
  return Math.floor(u * 37); // single-zero wheel 0..36
}

export function roulettePayout(bet, pick, number) {
  const b = String(bet || '').toLowerCase();
  if (b === 'number') return pick === number ? 36 : 0;
  if (b === 'red') return number !== 0 && ROULETTE_RED.has(number) ? 2 : 0;
  if (b === 'black') return number !== 0 && !ROULETTE_RED.has(number) ? 2 : 0;
  if (b === 'green') return number === 0 ? 36 : 0;
  if (b === 'even') return number !== 0 && number % 2 === 0 ? 2 : 0;
  if (b === 'odd') return number !== 0 && number % 2 === 1 ? 2 : 0;
  if (b === 'low') return number !== 0 && number <= 18 ? 2 : 0;
  if (b === 'high') return number !== 0 && number >= 19 ? 2 : 0;
  if (b === 'dozen1') return number >= 1 && number <= 12 ? 3 : 0;
  if (b === 'dozen2') return number >= 13 && number <= 24 ? 3 : 0;
  if (b === 'dozen3') return number >= 25 && number <= 36 ? 3 : 0;
  return 0;
}

const CARD_VALUES = { A: 11, K: 10, Q: 10, J: 10, T: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2 };

export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const v = CARD_VALUES[c[0].toUpperCase()];
    if (!v) continue;
    total += v;
    if (c[0].toUpperCase() === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return total;
}

export function drawCard(floats, offset = 0) {
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const f = floats[offset % floats.length].value;
  const rank = RANKS[Math.floor(f * 13)];
  const suit = SUITS[Math.floor((f * 13 * 4) % 4)];
  return `${rank}${suit}`;
}

export function baccaratResult(player, banker) {
  const pv = player % 10;
  const bv = banker % 10;
  if (pv > bv) return 'player';
  if (bv > pv) return 'banker';
  return 'tie';
}

const SLOT_SYMBOLS = [
  { key: 'cherry', emoji: '🍒', weight: 30, payout: 3 },
  { key: 'lemon', emoji: '🍋', weight: 26, payout: 4 },
  { key: 'bell', emoji: '🔔', weight: 20, payout: 6 },
  { key: 'clover', emoji: '🍀', weight: 14, payout: 10 },
  { key: 'star', emoji: '⭐', weight: 8, payout: 25 },
  { key: 'diamond', emoji: '💎', weight: 2, payout: 120 },
];

export function spinSlots(floats) {
  const total = SLOT_SYMBOLS.reduce((a, s) => a + s.weight, 0);
  const reels = floats.map((f) => {
    let r = f.value * total;
    for (const s of SLOT_SYMBOLS) { r -= s.weight; if (r <= 0) return s; }
    return SLOT_SYMBOLS[0];
  });
  let payout = 0;
  let label = 'no match';
  if (reels[0].key === reels[1].key && reels[1].key === reels[2].key) {
    payout = reels[0].payout;
    label = `triple ${reels[0].key}`;
  } else if (reels[0].key === reels[1].key || reels[1].key === reels[2].key || reels[0].key === reels[2].key) {
    payout = 1.4;
    label = 'pair';
  }
  return { reels, payout, label };
}

/* ------------------------------------------------------------- placement */

function validateWager(guildId, userId, wager) {
  const cfg = getGuild(guildId);
  const amt = Math.trunc(Number(wager));
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'wager_must_be_positive' };
  if (amt < cfg.min_bet) return { ok: false, reason: 'below_min_bet', min: cfg.min_bet };
  if (amt > cfg.max_bet) return { ok: false, reason: 'above_max_bet', max: cfg.max_bet };
  const u = getUser(guildId, userId);
  if (u.cash < amt) return { ok: false, reason: 'insufficient_cash', cash: u.cash };
  return { ok: true, amount: amt };
}

function recordBet(guildId, userId, game, wager, payout, detail, seedHash, nonce) {
  db.prepare(
    `INSERT INTO casino_bets (guild_id, user_id, game, wager, payout, detail, server_seed_hash, client_seed, nonce, ts)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(String(guildId), String(userId), game, wager, payout, detail ? JSON.stringify(detail) : null, seedHash || null, null, nonce ?? null, now());
}

/** Atomic wager → resolve → payout. */
export const playGame = db.transaction((guildId, userId, game, wager, options = {}) => {
  const gid = String(guildId);
  const uid = String(userId);
  const g = GAMES[game];
  if (!g) return { ok: false, reason: 'unknown_game' };
  const v = validateWager(gid, uid, wager);
  if (!v.ok) return v;
  const w = v.amount;
  const taken = debit(gid, uid, w, `casino_${game}_wager`);
  if (!taken.ok) return { ok: false, reason: 'insufficient_cash' };

  let result;
  let payout = 0;
  let floats = [];
  switch (game) {
    case 'dice': {
      const target = Math.max(2, Math.min(95, Number(options.target ?? 50)));
      const over = options.mode !== 'under';
      floats = nextFloats(gid, uid, 1);
      const rollv = Math.floor(floats[0].value * 10000) / 100 + 0.00; // 0.00 - 99.99
      const win = over ? rollv > target : rollv < target;
      const chance = over ? (100 - target) / 100 : target / 100;
      const mult = Math.round((g.edge / Math.max(0.01, chance)) * 100) / 100;
      payout = win ? Math.round(w * mult) : 0;
      result = { roll: rollv, target, mode: over ? 'over' : 'under', multiplier: mult, win };
      break;
    }
    case 'coinflip': {
      const pick = options.pick === 'tails' ? 'tails' : 'heads';
      floats = nextFloats(gid, uid, 1);
      const outcome = floats[0].value < 0.5 ? 'heads' : 'tails';
      const win = outcome === pick;
      payout = win ? Math.round(w * g.edge * 2) : 0;
      result = { pick, outcome, win, multiplier: win ? 1.96 : 0 };
      break;
    }
    case 'crash': {
      const auto = Math.max(1.01, Number(options.cashoutAt ?? 2));
      floats = nextFloats(gid, uid, 1);
      const point = crashPoint(floats[0].value);
      const win = point >= auto;
      payout = win ? Math.round(w * auto) : 0;
      result = { crash_at: Math.round(point * 100) / 100, cashout_at: auto, win };
      break;
    }
    case 'roulette': {
      floats = nextFloats(gid, uid, 1);
      const number = rouletteSpin(floats[0].value);
      const mult = roulettePayout(options.bet, Number(options.pick ?? 0), number);
      payout = mult ? Math.round(w * mult) : 0;
      result = { number, color: number === 0 ? 'green' : ROULETTE_RED.has(number) ? 'red' : 'black', bet: options.bet || 'red', multiplier: mult, win: mult > 0 };
      break;
    }
    case 'mines': {
      const mines = Math.max(1, Math.min(24, Number(options.mines ?? 3)));
      const picks = Math.max(1, Math.min(25 - mines, Number(options.picks ?? 1)));
      floats = nextFloats(gid, uid, 25);
      const mineSet = new Set();
      const order = floats.map((f, i) => ({ i, v: f.value })).sort((a, b) => a.v - b.v);
      for (let i = 0; i < mines; i += 1) mineSet.add(order[i].i);
      let safe = 0;
      let hit = false;
      for (let i = 0; i < picks; i += 1) {
        if (mineSet.has(i)) { hit = true; break; }
        safe += 1;
      }
      const mult = hit ? 0 : minesMultiplier(safe, mines);
      payout = hit ? 0 : Math.round(w * mult);
      result = { mines, picks, safe, minesPositions: [...mineSet].sort((a, b) => a - b), multiplier: mult, win: !hit };
      break;
    }
    case 'slots': {
      floats = nextFloats(gid, uid, 3);
      const spin = spinSlots(floats);
      payout = Math.round(w * spin.payout);
      result = { reels: spin.reels.map((r) => r.key), emojis: spin.reels.map((r) => r.emoji), label: spin.label, multiplier: spin.payout, win: payout > w };
      break;
    }
    case 'plinko': {
      const rows = Math.max(8, Math.min(16, Number(options.rows ?? 12)));
      const { probs, mults } = plinkoBuckets(rows);
      floats = nextFloats(gid, uid, rows);
      let idx = 0;
      const path = [];
      for (const f of floats) { const right = f.value >= 0.5; path.push(right ? 'R' : 'L'); if (right) idx += 1; }
      const mult = mults[idx];
      payout = Math.round(w * mult);
      result = { bucket: idx, mults, rows, path, multiplier: mult, win: mult > 1 };
      break;
    }
    case 'blackjack': {
      const stand = Number(options.stand ?? 17);
      floats = nextFloats(gid, uid, 12);
      let o = 0;
      const playerCards = [drawCard(floats, o++), drawCard(floats, o++)];
      const dealerCards = [drawCard(floats, o++), drawCard(floats, o++)];
      let pv = handValue(playerCards);
      let dv = handValue(dealerCards);
      let playerBust = false;
      while (pv < stand && o < floats.length) {
        playerCards.push(drawCard(floats, o++));
        pv = handValue(playerCards);
        if (pv > 21) { playerBust = true; break; }
      }
      if (!playerBust) {
        while (dv < 17 && o < floats.length) {
          dealerCards.push(drawCard(floats, o++));
          dv = handValue(dealerCards);
        }
      }
      const natural = playerCards.length === 2 && pv === 21 && !(dealerCards.length === 2 && dv === 21);
      let mult = 0;
      let outcome = 'push';
      if (playerBust) { mult = 0; outcome = 'bust'; }
      else if (dv > 21) { mult = 2; outcome = 'dealer_bust'; }
      else if (pv > dv) { mult = natural ? 2.5 : 2; outcome = natural ? 'blackjack' : 'win'; }
      else if (pv < dv) { mult = 0; outcome = 'lose'; }
      else { mult = 1; outcome = 'push'; }
      if (mult > 0) payout = Math.round(w * mult);
      result = {
        player: playerCards, dealer: dealerCards, player_total: pv, dealer_total: dv,
        outcome, natural, multiplier: mult, win: mult > 1,
      };
      break;
    }
    case 'baccarat': {
      const pick = ['player', 'banker', 'tie'].includes(options.pick) ? options.pick : 'player';
      floats = nextFloats(gid, uid, 6);
      const p = floats.slice(0, 3).reduce((a, f) => a + Math.floor(f.value * 13), 0);
      const b = floats.slice(3, 6).reduce((a, f) => a + Math.floor(f.value * 13), 0);
      const winner = baccaratResult(p, b);
      const mult = winner === pick ? (pick === 'tie' ? 9 : pick === 'banker' ? 1.95 : 2) : 0;
      payout = Math.round(w * mult);
      result = { player_total: p % 10, banker_total: b % 10, pick, winner, multiplier: mult, win: mult > 0 };
      break;
    }
    default:
      return { ok: false, reason: 'unimplemented_game' };
  }

  // Enforce the game's maximum single-win bound to protect the ledger.
  const cap = g.max_win_mult ? w * g.max_win_mult : null;
  if (cap && payout > cap) payout = Math.round(cap);
  if (payout > 0) credit(gid, uid, payout, `casino_${game}_win`, { ref: null });
  const seedHash = db.prepare('SELECT server_seed_hash FROM casino_seeds WHERE guild_id = ? AND user_id = ?').get(gid, uid)?.server_seed_hash;
  recordBet(gid, uid, game, w, payout, { ...result, floats: floats.map((f) => f.hash) }, seedHash, floats[0]?.nonce);
  logTx({ guildId: gid, userId: uid, amount: payout - w, kind: `casino_${game}_net`, meta: { wager: w, payout } });
  return { ok: true, game, wager: w, payout, net: payout - w, result, cash: getUser(gid, uid).cash };
});

/* --------------------------------------------------------------- history */

export const betHistory = (guildId, userId, limit = 15) => db
  .prepare('SELECT * FROM casino_bets WHERE guild_id = ? AND user_id = ? ORDER BY ts DESC, id DESC LIMIT ?')
  .all(String(guildId), String(userId), limit)
  .map((b) => ({ ...b, detail: b.detail ? JSON.parse(b.detail) : null }));

export function casinoLeaderboard(guildId, limit = 10) {
  return db.prepare(
    `SELECT user_id, COUNT(*) bets, SUM(wager) wagered, SUM(payout) won,
            SUM(payout - wager) net, SUM(CASE WHEN payout > 0 THEN 1 ELSE 0 END) wins
     FROM casino_bets WHERE guild_id = ? GROUP BY user_id ORDER BY net DESC LIMIT ?`,
  ).all(String(guildId), limit).map((r) => ({ ...r, win_rate: r.bets ? Math.round((r.wins / r.bets) * 100) : 0 }));
}

export function casinoStats(guildId) {
  const g = String(guildId);
  const row = db.prepare(
    `SELECT COUNT(*) bets, COALESCE(SUM(wager),0) wagered, COALESCE(SUM(payout),0) paid,
            COUNT(DISTINCT user_id) players FROM casino_bets WHERE guild_id = ?`,
  ).get(g);
  const byGame = db.prepare('SELECT game, COUNT(*) bets, SUM(wager) wagered, SUM(payout) paid FROM casino_bets WHERE guild_id = ? GROUP BY game ORDER BY bets DESC').all(g);
  const big = db.prepare('SELECT user_id, game, wager, payout, ts FROM casino_bets WHERE guild_id = ? ORDER BY payout DESC LIMIT 5').all(g);
  return { ...row, house_net: row.wagered - row.paid, by_game: byGame, biggest_wins: big };
}

/* --------------------------------------------------------------- lottery */

export const LOTTERY_TICKET = 5000;

export const buyLotteryTicket = db.transaction((guildId, userId, count = 1) => {
  const gid = String(guildId);
  const uid = String(userId);
  const n = Math.max(1, Math.min(50, Math.trunc(Number(count) || 1)));
  const cost = LOTTERY_TICKET * n;
  const res = debit(gid, uid, cost, 'lottery_ticket');
  if (!res.ok) return { ok: false, reason: 'insufficient_cash', cost };
  const round = currentLotteryRound(gid);
  db.prepare(
    `INSERT INTO lottery_tickets (guild_id, round_id, user_id, tickets, bought_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(guild_id, round_id, user_id) DO UPDATE SET tickets = tickets + excluded.tickets`,
  ).run(gid, round.id, uid, n, now());
  return { ok: true, tickets: n, cost, round: round.id };
});

export function currentLotteryRound(guildId) {
  const gid = String(guildId);
  let row = db.prepare("SELECT * FROM lottery_rounds WHERE guild_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(gid);
  if (!row) {
    const info = db.prepare("INSERT INTO lottery_rounds (guild_id, pot, status, ends_at, created_at) VALUES (?,0,'open',?,?)")
      .run(gid, now() + 24 * 3600 * 1000, now());
    row = db.prepare('SELECT * FROM lottery_rounds WHERE id = ?').get(info.lastInsertRowid);
  }
  return row;
}

export function lotteryRound(guildId) {
  const round = currentLotteryRound(guildId);
  const tickets = db.prepare('SELECT user_id, tickets FROM lottery_tickets WHERE guild_id = ? AND round_id = ? ORDER BY tickets DESC')
    .all(String(guildId), round.id);
  return { ...round, pot: tickets.reduce((a, t) => a + t.tickets * LOTTERY_TICKET, 0), tickets };
}

export const drawLottery = db.transaction((guildId) => {
  const gid = String(guildId);
  const round = currentLotteryRound(gid);
  const tickets = db.prepare('SELECT user_id, tickets FROM lottery_tickets WHERE guild_id = ? AND round_id = ?').all(gid, round.id);
  if (!tickets.length) return { ok: false, reason: 'no_tickets' };
  const pot = tickets.reduce((a, t) => a + t.tickets * LOTTERY_TICKET, 0);
  const winnerPool = [];
  for (const t of tickets) for (let i = 0; i < t.tickets; i += 1) winnerPool.push(t.user_id);
  const winner = winnerPool[crypto.randomInt(winnerPool.length)];
  const pay = Math.floor(pot * 0.9);
  credit(gid, winner, pay, 'lottery_win', { meta: { round: round.id } });
  db.prepare("UPDATE lottery_rounds SET status = 'drawn', winner_id = ?, pot = ?, drawn_at = ? WHERE id = ?")
    .run(winner, pay, now(), round.id);
  return { ok: true, winner, pot, payout: pay, round: round.id };
});

export const GAME_KEYS = Object.keys(GAMES);
export { GAMES, SLOT_SYMBOLS };
