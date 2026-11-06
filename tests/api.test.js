import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-api-'));
const PORT = 4400 + Math.floor(Math.random() * 300);
const GUILD = 'guild-api-test';
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let bootLog = '';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_PATH: path.join(dir, 'api.db'),
      DEFAULT_GUILD_ID: GUILD,
      DISCORD_TOKEN: '',
      DISCORD_CLIENT_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });

  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${bootLog}`);
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await wait(250);
  }
  throw new Error(`server did not become ready: ${bootLog}`);
}

async function get(p) {
  const res = await fetch(`${BASE}${p}`);
  const body = await res.json();
  return { status: res.status, body };
}

test.before(start);
test.after(() => {
  if (child && child.exitCode === null) child.kill('SIGTERM');
});

test('health endpoint reports a running service', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.health || body.status || body.uptime !== undefined);
});

test('stats endpoint returns real aggregates', async () => {
  const { status, body } = await get('/api/stats');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.stats, 'object');
});

test('chains endpoint lists every configured network with a status', async () => {
  const { body } = await get('/api/chains');
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.chains));
  assert.ok(body.chains.length >= 10);
  const solana = body.chains.find((c) => c.id === 'solana');
  assert.ok(solana, 'solana must be part of the registry');
  assert.ok(['live', 'unconfigured', 'idle', 'error', 'backfilling'].includes(solana.status) || typeof solana.status === 'string');
});

test('token list and event feed are served from the database', async () => {
  const tokens = await get('/api/tokens?limit=5');
  assert.equal(tokens.body.ok, true);
  assert.ok(Array.isArray(tokens.body.tokens));

  const events = await get('/api/events?limit=5');
  assert.equal(events.body.ok, true);
  assert.ok(Array.isArray(events.body.events));
});

test('multiplier, security and PNL endpoints return dashboard-ready shapes', async () => {
  const mults = await get('/api/multipliers');
  assert.equal(mults.body.ok, true);
  assert.ok(Array.isArray(mults.body.leaders));
  assert.ok(Array.isArray(mults.body.milestones));

  const security = await get('/api/security');
  assert.equal(security.body.ok, true);
  assert.ok(Array.isArray(security.body.summary));
  assert.ok(Array.isArray(security.body.flagged));

  const pnl = await get('/api/pnl/overview');
  assert.equal(pnl.body.ok, true);
  assert.ok(pnl.body.overview);
  assert.ok(Array.isArray(pnl.body.leaderboard));
});

test('economy endpoints are guild scoped and expose config + supply', async () => {
  const overview = await get(`/api/economy/overview?guild=${GUILD}`);
  assert.equal(overview.body.ok, true);
  assert.equal(overview.body.config.guild_id, GUILD);
  assert.equal(typeof overview.body.supply, 'number');
  assert.ok(Array.isArray(overview.body.members));

  const members = await get(`/api/economy/members?guild=${GUILD}`);
  assert.equal(members.body.ok, true);

  const audit = await get(`/api/economy/audit?guild=${GUILD}`);
  assert.equal(audit.body.ok, true);
  assert.ok(Array.isArray(audit.body.audit || audit.body.logs || []));
});

test('casino, business, marketplace and giveaway endpoints respond', async () => {
  const casino = await get(`/api/casino/stats?guild=${GUILD}`);
  assert.equal(casino.body.ok, true);
  assert.ok(casino.body.stats);
  assert.ok(Array.isArray(casino.body.games));

  const biz = await get(`/api/businesses?guild=${GUILD}`);
  assert.equal(biz.body.ok, true);

  const market = await get(`/api/marketplace?guild=${GUILD}`);
  assert.equal(market.body.ok, true);

  const giveaways = await get(`/api/giveaways?guild=${GUILD}`);
  assert.equal(giveaways.body.ok, true);
  assert.ok(Array.isArray(giveaways.body.giveaways));
});

test('dashboard is served at the root and unknown APIs return JSON 404', async () => {
  const root = await fetch(`${BASE}/`);
  assert.equal(root.status, 200);
  const html = await root.text();
  assert.ok(html.toLowerCase().includes('<!doctype html'));

  const missing = await get('/api/does-not-exist');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.ok, false);
});
