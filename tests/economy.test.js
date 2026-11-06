import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-econ-'));
process.env.DATABASE_PATH = path.join(dir, 'econ.db');

const { initSchema } = await import('../server/db.js');
initSchema();
const store = await import('../server/economy/store.js');

const G = 'guild-econ';
const A = 'user-a';
const B = 'user-b';

test('new wallet is created with the configured starting balance', () => {
  const cfg = store.getGuild(G);
  const user = store.getUser(G, A);
  assert.equal(user.cash, cfg.starting_balance);
  assert.equal(user.bank, 0);
});

test('wallets are isolated per guild', () => {
  store.setBalance(G, A, 'cash', 1234);
  const other = store.getUser('guild-other', A);
  assert.notEqual(other.cash, 1234);
});

test('authorized admin can mint currency into an empty wallet', () => {
  store.setBalance(G, B, 'cash', 0);
  assert.equal(store.getUser(G, B).cash, 0);
  const cash = store.credit(G, B, 1_000_000_000, 'admin_mint', { ref: 'owner-grant' });
  assert.equal(cash, 1_000_000_000);
});

test('debit never allows a negative balance', () => {
  store.setBalance(G, A, 'cash', 500);
  const rejected = store.debit(G, A, 501, 'test');
  assert.equal(rejected.ok, false);
  assert.equal(store.getUser(G, A).cash, 500);
  const accepted = store.debit(G, A, 500, 'test');
  assert.equal(accepted.ok, true);
  assert.equal(accepted.cash, 0);
});

test('transfer moves exactly the amount or nothing at all', () => {
  store.setBalance(G, A, 'cash', 1000);
  store.setBalance(G, B, 'cash', 250);

  const ok = store.transfer(G, A, B, 400);
  assert.equal(ok.ok, true);
  assert.equal(store.getUser(G, A).cash, 600);
  assert.equal(store.getUser(G, B).cash, 650);

  const failed = store.transfer(G, A, B, 10_000);
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'insufficient_cash');
  assert.equal(store.getUser(G, A).cash, 600);
  assert.equal(store.getUser(G, B).cash, 650);
});

test('transfer rejects self-payments and non-positive amounts', () => {
  assert.throws(() => store.transfer(G, A, A, 10));
  assert.throws(() => store.transfer(G, A, B, 0));
  assert.throws(() => store.transfer(G, A, B, -5));
});

test('bank deposit and withdraw keep cash + bank conserved', () => {
  store.setBalance(G, A, 'cash', 1000);
  store.setBalance(G, A, 'bank', 0);

  const deposit = store.depositBank(G, A, 600);
  assert.equal(deposit.ok, true);
  assert.equal(store.getUser(G, A).cash, 400);
  assert.equal(store.getUser(G, A).bank, 600);

  try {
    store.withdrawBank(G, A, 900);
  } catch {
    /* rejection may surface as an error; balances must still be untouched */
  }
  assert.equal(store.getUser(G, A).cash, 400);
  assert.equal(store.getUser(G, A).bank, 600);
});

test('setBalance validates field and amount', () => {
  assert.throws(() => store.setBalance(G, A, 'gold', 5));
  assert.throws(() => store.setBalance(G, A, 'cash', -1));
});

test('resetBalance restores starting balance and clears the bank', () => {
  const cfg = store.getGuild(G);
  store.setBalance(G, A, 'cash', 99_999);
  store.setBalance(G, A, 'bank', 5_000);
  const reset = store.resetBalance(G, A);
  assert.equal(reset.cash, cfg.starting_balance);
  assert.equal(reset.bank, 0);
});

test('audit log keeps an ordered record of privileged actions', () => {
  store.audit(G, 'owner-1', 'addmoney', A, 1_000_000, { reason: 'event prize' });
  store.audit(G, 'owner-1', 'removemoney', A, 500, { reason: 'correction' });
  const log = store.auditLog(G, 10);
  assert.ok(log.length >= 2);
  assert.equal(log[0].action, 'removemoney');
  assert.equal(log[0].amount, 500);
  assert.equal(log[1].action, 'addmoney');
});

test('transaction history records both directions', () => {
  const rows = store.txHistory(G, A, 100);
  assert.ok(rows.length > 0);
  assert.ok(rows.some((r) => r.amount < 0));
  assert.ok(rows.some((r) => r.amount > 0));
});

test('net worth sums cash, bank and business value', () => {
  store.setBalance(G, A, 'cash', 100);
  store.setBalance(G, A, 'bank', 250);
  const worth = store.netWorth(G, A);
  assert.equal(worth.cash, 100);
  assert.equal(worth.bank, 250);
  assert.equal(worth.total, worth.cash + worth.bank + worth.businesses);
});

test('leaderboard ranks members by combined balance', () => {
  store.setBalance(G, 'rich', 'cash', 10_000_000);
  const board = store.leaderboard(G, { limit: 5 });
  assert.ok(board.length >= 1);
  assert.equal(board[0].user_id, 'rich');
});
