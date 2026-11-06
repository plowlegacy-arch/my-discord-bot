import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-tracker-'));
process.env.DATABASE_PATH = path.join(dir, 'tracker.db');

const { db, initSchema } = await import('../server/db.js');
initSchema();
const tokens = await import('../server/services/tokens.js');
const tracker = await import('../server/services/tracker.js');

test('milestone ladder is ascending, bounded by the current multiple, and uncapped', () => {
  const ladder = tracker.milestoneLadder(5000);
  assert.ok(ladder.length >= 4);
  for (let i = 1; i < ladder.length; i += 1) assert.ok(ladder[i] > ladder[i - 1]);
  for (const m of ladder) assert.ok(m <= 5000);

  const bigger = tracker.milestoneLadder(1e9);
  assert.ok(bigger.length > ladder.length, 'ladder must keep extending for larger multiples');
  assert.ok(bigger[bigger.length - 1] > ladder[ladder.length - 1]);
});

test('multiplierOf ignores missing or invalid baselines', () => {
  assert.equal(tracker.multiplierOf(2, 0.5), 4);
  assert.equal(tracker.multiplierOf(2, null), null);
  assert.equal(tracker.multiplierOf(2, 0), null);
  assert.equal(tracker.multiplierOf(null, 1), null);
});

test('tracked token keeps its original baseline and records milestones once', () => {
  const token = tokens.upsertToken({
    chain: 'ethereum',
    address: '0x0000000000000000000000000000000000000abc',
    name: 'Baseline Test',
    symbol: 'BASE',
    stage: 'deployed',
  });
  assert.ok(token?.id);

  tracker.ensureBaseline(token.id, { price: 0.001, source: 'first_observed', at: Date.now() - 60_000 });
  db.prepare('UPDATE tokens SET price = ?, market_cap = ?, liquidity_usd = ? WHERE id = ?')
    .run(0.01, 100_000, 25_000, token.id);

  const events = tracker.trackMultipliers(tokens.getTokenById(token.id));
  assert.ok(events.length >= 1, 'a 10x move must emit milestone events');

  const rows = db.prepare('SELECT multiple, basis FROM milestones WHERE token_id = ? ORDER BY multiple').all(token.id);
  assert.ok(rows.length >= 2);
  for (const row of rows) assert.ok(row.multiple <= 10.0001);
  assert.ok(rows.every((r) => r.basis === 'price' || r.basis === 'marketcap'));

  const before = tokens.getTokenById(token.id);
  assert.equal(before.baseline_price, 0.001, 'baseline must never be reset');
  assert.equal(before.baseline_source, 'first_observed');

  tracker.trackMultipliers(tokens.getTokenById(token.id));
  const after = db.prepare('SELECT COUNT(*) c FROM milestones WHERE token_id = ?').get(token.id).c;
  assert.equal(after, rows.length, 'repeated tracking must not duplicate milestones');
});

test('price snapshots preserve history for charts', () => {
  const token = tokens.upsertToken({
    chain: 'base',
    address: '0x0000000000000000000000000000000000000def',
    name: 'Snapshot Test',
    symbol: 'SNAP',
  });
  tokens.snapshotPrice(token.id, { price: 0.5, marketCap: 5_000_000, liquidityUsd: 900_000, source: 'dex' });
  tokens.snapshotPrice(token.id, { price: 1.5, marketCap: 15_000_000, liquidityUsd: 1_500_000, source: 'dex' });
  const detail = tracker.tokenDetail(token.id);
  assert.ok(detail);
  assert.ok(Array.isArray(detail.snapshots));
  assert.ok(detail.snapshots.length >= 2);
});

test('token feed separates deployment, launch and liquidity stages', () => {
  const deployed = tokens.upsertToken({ chain: 'solana', address: 'Deploy111111111111111111111111111111111111', name: 'D', symbol: 'D' });
  const launched = tokens.upsertToken({ chain: 'solana', address: 'Launch111111111111111111111111111111111111', name: 'L', symbol: 'L', stage: 'launched' });

  assert.equal(deployed.stage, 'deployed');
  assert.equal(launched.stage, 'launched');
  assert.ok(tokens.stageRank('liquid') > tokens.stageRank('deployed'));

  tokens.recordEvent({ chain: 'solana', address: deployed.address, type: 'deploy', tx: 'sig1', token_id: deployed.id });
  const feed = tokens.feedEvents({ type: 'deploy', limit: 10 });
  assert.ok(feed.some((e) => e.address === deployed.address));
});
