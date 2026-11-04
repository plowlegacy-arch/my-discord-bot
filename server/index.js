import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, initSchema, now } from './db.js';
import { CHAINS, chainById, explorerToken, explorerTx } from './chains/registry.js';
import { indexerState, indexerLogs, startIndexer, stopIndexer, triggerScan } from './chains/indexer.js';
import { listTokens, feedEvents, stats, getToken, tokenEvents } from './services/tokens.js';
import { tokenDetail, multiplierLeaders, recentMilestoneFeed, bus } from './services/tracker.js';
import { walletPnl, pnlLeaderboard, pnlOverview, walletHistory } from './services/pnl.js';
import { riskSummary } from './services/security.js';
import {
  getGuild, updateGuild, leaderboard, netWorth, txHistory, auditLog, getUser, getUser as _u,
} from './economy/store.js';
import { casinoStats, casinoLeaderboard, betHistory, gameList } from './economy/casino.js';
import { businessLeaderboard, businessList, PROPERTIES, userBusinesses } from './economy/business.js';
import { listings as marketListings, inventory } from './economy/marketplace.js';
import { profile as socialProfile, achievementsOf } from './economy/social.js';
import { startBot, botState } from './discord/bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);

initSchema();

const app = express();
app.use(express.json({ limit: '256kb' }));
app.disable('x-powered-by');

const DEFAULT_GUILD = process.env.DEFAULT_GUILD_ID || 'preview';
const guildOf = (req) => String(req.query.guild || req.body?.guild || DEFAULT_GUILD);

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, code, message) => res.status(code).json({ ok: false, error: message });
const wrap = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    console.error('[api]', err.message);
    if (!res.headersSent) fail(res, 500, err.message || 'internal error');
  }
};

/* ------------------------------------------------------------------ health */

app.get('/api/health', wrap((req, res) => ok(res, {
  service: 'trench-scanner',
  uptime_s: Math.round(process.uptime()),
  time: now(),
  chains_live: CHAINS.filter((c) => c.status === 'live').length,
  bot: botState(),
})));

app.get('/api/stats', wrap((req, res) => {
  const s = stats();
  const risk = riskSummary();
  const tokens = db.prepare('SELECT COUNT(*) c FROM tokens').get().c;
  const milestones = db.prepare('SELECT COUNT(*) c FROM milestones').get().c;
  const top = db
    .prepare(
      `SELECT id, chain, symbol, name, address, price, market_cap, liquidity_usd, stage,
        CASE WHEN baseline_price > 0 AND price > 0 THEN price / baseline_price END AS multiplier
       FROM tokens WHERE price > 0 AND baseline_price > 0 ORDER BY multiplier DESC LIMIT 8`,
    )
    .all();
  const volume = db.prepare('SELECT COALESCE(SUM(volume_usd),0) v FROM tokens').get().v;
  ok(res, { ...s, risk, tokens, milestones, volume, top_movers: top, bot: botState() });
}));

/* ------------------------------------------------------------------ chains */

app.get('/api/chains', wrap((req, res) => ok(res, { chains: indexerState() })));

app.post('/api/chains/:id/scan', wrap((req, res) => {
  const chain = chainById(req.params.id);
  if (!chain) return fail(res, 404, 'unknown chain');
  triggerScan(chain.id)
    .then((result) => ok(res, { chain: chain.id, result }))
    .catch((err) => fail(res, 400, err.message));
  return undefined;
}));

app.get('/api/logs', wrap((req, res) => ok(res, {
  logs: indexerLogs({ chain: req.query.chain || undefined, limit: Math.min(Number(req.query.limit) || 60, 200) }),
})));

/* ------------------------------------------------------------------ tokens */

app.get('/api/tokens', wrap((req, res) => {
  const { rows, total } = listTokens({
    chain: req.query.chain || undefined,
    stage: req.query.stage || undefined,
    feed: req.query.feed || undefined,
    search: req.query.search || undefined,
    sort: req.query.sort || 'newest',
    limit: req.query.limit,
    offset: req.query.offset,
    minLiquidity: Number(req.query.minLiquidity) || 0,
  });
  const chains = new Map(CHAINS.map((c) => [c.id, c]));
  ok(res, {
    total,
    tokens: rows.map((t) => ({
      ...t,
      multiplier: t.baseline_price > 0 && t.price > 0 ? t.price / t.baseline_price : null,
      explorer: explorerToken(chains.get(t.chain) || {}, t.address),
    })),
  });
}));

app.get('/api/events', wrap((req, res) => ok(res, {
  events: feedEvents({ type: req.query.type || undefined, chain: req.query.chain || undefined, limit: Math.min(Number(req.query.limit) || 40, 200) }),
})));

app.get('/api/tokens/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return fail(res, 400, 'numeric token id required');
  const detail = tokenDetail(id);
  if (!detail) return fail(res, 404, 'token not found');
  const chains = new Map(CHAINS.map((c) => [c.id, c]));
  const chain = chains.get(detail.chain) || {};
  return ok(res, {
    token: {
      ...detail,
      explorer: explorerToken(chain, detail.address),
      explorer_tx: explorerTx(chain, detail.deploy_tx),
      security: detail.risk_report,
    },
  });
}));

app.get('/api/tokens/lookup/:chain/:address', wrap((req, res) => {
  const t = getToken(req.params.chain, req.params.address);
  if (!t) return fail(res, 404, 'token not found');
  ok(res, { token: tokenDetail(t.id), events: tokenEvents(t.id, 30) });
}));

app.get('/api/multipliers', wrap((req, res) => ok(res, {
  leaders: multiplierLeaders(Math.min(Number(req.query.limit) || 30, 100)),
  milestones: recentMilestoneFeed(Math.min(Number(req.query.milestones) || 25, 100)),
})));

app.get('/api/pnl/overview', wrap((req, res) => ok(res, { overview: pnlOverview(), leaderboard: pnlLeaderboard(15) })));

app.get('/api/pnl/wallet/:chain/:address', wrap((req, res) => {
  const p = walletPnl(req.params.chain, req.params.address);
  ok(res, { pnl: p, history: walletHistory(req.params.chain, req.params.address, 60) });
}));

app.get('/api/security', wrap((req, res) => {
  const summary = riskSummary();
  const flagged = db
    .prepare(
      `SELECT id, chain, symbol, name, risk_score, risk_level, liquidity_usd, market_cap
       FROM tokens WHERE risk_level IS NOT NULL ORDER BY risk_score DESC LIMIT 25`,
    )
    .all();
  ok(res, { summary, flagged });
}));

/* ----------------------------------------------------------------- economy */

app.get('/api/economy/overview', wrap((req, res) => {
  const gid = guildOf(req);
  const cfg = getGuild(gid);
  const users = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(cash),0) cash, COALESCE(SUM(bank),0) bank FROM econ_users WHERE guild_id = ?').get(gid);
  const txs = db.prepare('SELECT COUNT(*) c FROM econ_tx WHERE guild_id = ?').get(gid).c;
  const bets = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(wager),0) w, COALESCE(SUM(payout),0) p FROM casino_bets WHERE guild_id = ?').get(gid);
  return ok(res, {
    config: cfg,
    members: users.c,
    cash: users.cash,
    bank: users.bank,
    supply: users.cash + users.bank,
    transactions: txs,
    bets,
    leaderboard: leaderboard(gid, { limit: 12 }),
    games: gameList(),
  });
}));

app.get('/api/economy/config', wrap((req, res) => ok(res, { config: getGuild(guildOf(req)) })));

app.patch('/api/economy/config', wrap((req, res) => {
  const cfg = updateGuild(guildOf(req), req.body || {});
  ok(res, { config: cfg });
}));

app.get('/api/economy/leaderboard', wrap((req, res) => ok(res, {
  leaderboard: leaderboard(guildOf(req), { by: req.query.by || 'total', limit: Math.min(Number(req.query.limit) || 25, 100) }),
  businesses: businessLeaderboard(guildOf(req), 10),
  casino: casinoLeaderboard(guildOf(req), 10),
})));

app.get('/api/economy/members', wrap((req, res) => {
  const gid = guildOf(req);
  const rows = db
    .prepare('SELECT user_id, cash, bank, level, xp, career, career_level, married_to FROM econ_users WHERE guild_id = ? ORDER BY (cash + bank) DESC LIMIT 60')
    .all(gid);
  ok(res, { members: rows.map((r) => ({ ...r, net_worth: netWorth(gid, r.user_id).total })) });
}));

app.get('/api/economy/member/:id', wrap((req, res) => {
  const gid = guildOf(req);
  const id = req.params.id;
  const worth = netWorth(gid, id);
  ok(res, {
    user: getUser(gid, id),
    netWorth: worth,
    profile: socialProfile(gid, id, worth.total),
    achievements: achievementsOf(gid, id),
    inventory: inventory(gid, id),
    businesses: userBusinesses(gid, id),
    transactions: txHistory(gid, id, 25),
    bets: betHistory(gid, id, 15),
  });
}));

app.get('/api/economy/transactions', wrap((req, res) => {
  const gid = guildOf(req);
  const rows = db
    .prepare('SELECT * FROM econ_tx WHERE guild_id = ? ORDER BY ts DESC, id DESC LIMIT 80')
    .all(gid);
  ok(res, { transactions: rows });
}));

app.get('/api/economy/audit', wrap((req, res) => ok(res, {
  audit: auditLog(guildOf(req), Math.min(Number(req.query.limit) || 50, 200)),
})));

app.get('/api/casino/stats', wrap((req, res) => {
  const gid = guildOf(req);
  ok(res, { stats: casinoStats(gid), games: gameList(), leaderboard: casinoLeaderboard(gid, 12) });
}));

app.get('/api/businesses', wrap((req, res) => {
  const gid = guildOf(req);
  ok(res, {
    types: businessList(),
    properties: Object.entries(PROPERTIES).map(([key, p]) => ({ key, ...p })),
    leaderboard: businessLeaderboard(gid, 12),
    owned: db.prepare('SELECT type, COUNT(*) c, SUM(level) levels FROM businesses WHERE guild_id = ? GROUP BY type').all(gid),
  });
}));

app.get('/api/marketplace', wrap((req, res) => {
  const gid = guildOf(req);
  ok(res, { listings: marketListings(gid, { status: req.query.status || 'open', limit: 40 }) });
}));

app.get('/api/giveaways', wrap((req, res) => {
  const gid = guildOf(req);
  const rows = db.prepare('SELECT * FROM giveaways WHERE guild_id = ? ORDER BY created_at DESC LIMIT 40').all(gid);
  ok(res, {
    giveaways: rows.map((g) => {
      const safe = (v) => { try { return JSON.parse(v); } catch { return null; } };
      return { ...g, entries: safe(g.entries) || [], winner_ids: safe(g.winner_ids) || [], requirements: safe(g.requirements) };
    }),
  });
}));

/* ----------------------------------------------------------- live feed SSE */

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ time: now() })}\n\n`);
  const send = (kind) => (payload) => {
    res.write(`event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const onToken = send('token');
  const onMilestone = send('milestone');
  const onEvent = send('event');
  bus.on('token:new', onToken);
  bus.on('token:update', onToken);
  bus.on('milestone', onMilestone);
  bus.on('event', onEvent);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    bus.off('token:new', onToken);
    bus.off('token:update', onToken);
    bus.off('milestone', onMilestone);
    bus.off('event', onEvent);
  });
});

/* -------------------------------------------------------------- dashboard */

const dist = path.join(ROOT, 'dashboard', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.type('text/plain').send('TRENCH SCANNER API running. Build the dashboard with npm run build.'));
}

app.use((req, res) => fail(res, 404, 'not found'));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[trench-scanner] dashboard + api on http://0.0.0.0:${PORT}`);
  startIndexer();
  startBot().catch((err) => console.warn('[discord] not started:', err.message));
});

const shutdown = () => {
  stopIndexer();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, server };
