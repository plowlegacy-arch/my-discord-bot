import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-casino-'));
process.env.DATABASE_PATH = path.join(dir, 'casino.db');

const { initSchema } = await import('../server/db.js');
initSchema();
const casino = await import('../server/economy/casino.js');
const store = await import('../server/economy/store.js');

const G = 'guild-casino';
const U = 'user-gambler';

test('crash curve is monotonic in the uniform draw and bounded', () => {
  let prev = 0;
  for (let i = 0; i <= 90; i += 1) {
    const point = casino.crashPoint(i / 100);
    assert.ok(Number.isFinite(point));
    assert.ok(point >= 1);
    assert.ok(point >= prev - 1e-9);
    prev = point;
  }
  assert.ok(casino.crashPoint(0.999999) <= 1e6);
});

test('mines multiplier grows with revealed gems and shrinks with more mines', () => {
  assert.equal(casino.minesMultiplier(0, 3), 1);
  const one = casino.minesMultiplier(1, 3);
  const three = casino.minesMultiplier(3, 3);
  assert.ok(three > one);
  assert.ok(casino.minesMultiplier(3, 1) > casino.minesMultiplier(3, 20));
});

test('plinko buckets form a valid distribution with a house edge', () => {
  const { probs, mults } = casino.plinkoBuckets(12);
  assert.equal(probs.length, 13);
  assert.equal(mults.length, 13);
  const sum = probs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6);
  for (const m of mults) assert.ok(m >= 0.2);
  const ev = probs.reduce((a, p, i) => a + p * mults[i], 0);
  assert.ok(ev < 1, `plinko expected value ${ev} must stay below 1`);
});

test('roulette spins stay on a single-zero wheel and pay correctly', () => {
  assert.equal(casino.rouletteSpin(0), 0);
  assert.equal(casino.rouletteSpin(0.999999), 36);

  assert.equal(casino.roulettePayout('red', 0, 7), 2);
  assert.equal(casino.roulettePayout('red', 0, 8), 0);
  assert.equal(casino.roulettePayout('red', 0, 0), 0);
  assert.equal(casino.roulettePayout('black', 0, 8), 2);
  assert.equal(casino.roulettePayout('green', 0, 0), 36);
  assert.equal(casino.roulettePayout('number', 17, 17), 36);
  assert.equal(casino.roulettePayout('number', 17, 18), 0);
  assert.equal(casino.roulettePayout('even', 0, 0), 0);
  assert.equal(casino.roulettePayout('dozen2', 0, 24), 3);
  assert.equal(casino.roulettePayout('dozen2', 0, 25), 0);
  assert.equal(casino.roulettePayout('high', 0, 36), 2);
});

test('blackjack hand values soften aces', () => {
  assert.equal(casino.handValue(['A♠', 'K♥']), 21);
  assert.equal(casino.handValue(['A♠', 'A♥', '9♦']), 21);
  assert.equal(casino.handValue(['A♠', 'A♥']), 12);
  assert.equal(casino.handValue(['K♠', 'Q♥', 'J♦']), 30);
});

test('baccarat compares point totals', () => {
  assert.equal(casino.baccaratResult(9, 7), 'player');
  assert.equal(casino.baccaratResult(3, 8), 'banker');
  assert.equal(casino.baccaratResult(5, 15), 'tie');
});

test('slots pay only on matches', () => {
  const none = casino.spinSlots([{ value: 0 }, { value: 0.9 }, { value: 0.5 }]);
  assert.equal(none.payout, 0);
  const triple = casino.spinSlots([{ value: 0.01 }, { value: 0.01 }, { value: 0.01 }]);
  assert.equal(triple.payout, 3);
  assert.equal(triple.label, 'triple cherry');
});

test('wagers above the balance are rejected without moving funds', () => {
  store.setBalance(G, U, 'cash', 100);
  try {
    casino.playGame(G, U, 'dice', 100_000);
  } catch {
    /* rejection may throw; the balance must be untouched either way */
  }
  assert.equal(store.getUser(G, U).cash, 100);
});

test('casino statistics aggregate recorded bets', () => {
  store.setBalance(G, U, 'cash', 50_000);
  const play = casino.playGame(G, U, 'coinflip', 1000, { pick: 'heads' });
  assert.ok(play, 'playGame should resolve');
  const stats = casino.casinoStats(G);
  assert.ok(stats.bets >= 1);
  assert.ok(stats.wagered >= 1000);
  const history = casino.betHistory(G, U, 5);
  assert.ok(history.length >= 1);
});
