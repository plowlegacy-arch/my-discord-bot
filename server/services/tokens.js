import { db, now } from '../db.js';

const upsertStmt = () => db.prepare(`
INSERT INTO tokens (chain, address, name, symbol, decimals, creator, deploy_tx, deploy_block, deploy_hash,
  created_at, first_seen_at, initial_supply, total_supply, launchpad, dex, pool, quote_token, stage, verified,
  metadata, updated_at)
VALUES (@chain, @address, @name, @symbol, @decimals, @creator, @deploy_tx, @deploy_block, @deploy_hash,
  @created_at, @first_seen_at, @initial_supply, @total_supply, @launchpad, @dex, @pool, @quote_token, @stage, @verified,
  @metadata, @updated_at)
ON CONFLICT(chain, address) DO UPDATE SET
  name = COALESCE(excluded.name, tokens.name),
  symbol = COALESCE(excluded.symbol, tokens.symbol),
  decimals = COALESCE(excluded.decimals, tokens.decimals),
  creator = COALESCE(tokens.creator, excluded.creator),
  deploy_tx = COALESCE(tokens.deploy_tx, excluded.deploy_tx),
  deploy_block = COALESCE(tokens.deploy_block, excluded.deploy_block),
  deploy_hash = COALESCE(tokens.deploy_hash, excluded.deploy_hash),
  created_at = COALESCE(tokens.created_at, excluded.created_at),
  initial_supply = COALESCE(tokens.initial_supply, excluded.initial_supply),
  total_supply = COALESCE(excluded.total_supply, tokens.total_supply),
  launchpad = COALESCE(tokens.launchpad, excluded.launchpad),
  dex = COALESCE(tokens.dex, excluded.dex),
  pool = COALESCE(tokens.pool, excluded.pool),
  quote_token = COALESCE(tokens.quote_token, excluded.quote_token),
  metadata = COALESCE(excluded.metadata, tokens.metadata),
  verified = MAX(tokens.verified, excluded.verified),
  updated_at = excluded.updated_at
RETURNING *;
`);

const STAGE_ORDER = ['deployed', 'minted', 'launched', 'liquid', 'trading', 'migrated'];
export const stageRank = (s) => STAGE_ORDER.indexOf(s);

export function upsertToken(input) {
  const ts = now();
  const row = {
    chain: input.chain,
    address: input.address,
    name: input.name ?? null,
    symbol: input.symbol ?? null,
    decimals: input.decimals ?? null,
    creator: input.creator ?? null,
    deploy_tx: input.deploy_tx ?? null,
    deploy_block: input.deploy_block ?? null,
    deploy_hash: input.deploy_hash ?? null,
    created_at: input.created_at ?? input.first_seen_at ?? ts,
    first_seen_at: input.first_seen_at ?? ts,
    initial_supply: input.initial_supply ?? null,
    total_supply: input.total_supply ?? null,
    launchpad: input.launchpad ?? null,
    dex: input.dex ?? null,
    pool: input.pool ?? null,
    quote_token: input.quote_token ?? null,
    stage: input.stage ?? 'deployed',
    verified: input.verified ?? 0,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    updated_at: ts,
  };
  const token = upsertStmt().get(row);
  if (token) {
    db.prepare(
      `UPDATE tokens SET
        created_at = COALESCE(created_at, @created_at),
        first_seen_at = MIN(first_seen_at, @first_seen_at),
        updated_at = @ts
       WHERE id = @id`,
    ).run({ created_at: row.created_at, first_seen_at: row.first_seen_at, ts, id: token.id });
  }
  return db.prepare('SELECT * FROM tokens WHERE chain = ? AND address = ?').get(input.chain, input.address);
}

export function advanceStage(token, stage) {
  if (!token) return token;
  if (stageRank(stage) <= stageRank(token.stage) && token.stage !== 'deployed') return token;
  db.prepare('UPDATE tokens SET stage = ?, updated_at = ? WHERE id = ?').run(stage, now(), token.id);
  return { ...token, stage };
}

export function recordEvent(evt) {
  const ts = evt.ts ?? now();
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO token_events
        (token_id, chain, address, type, tx, block, block_hash, log_index, ts, actor, payload, created_at)
       VALUES (@token_id, @chain, @address, @type, @tx, @block, @block_hash, @log_index, @ts, @actor, @payload, @created_at)`,
    )
    .run({
      token_id: evt.token_id ?? null,
      chain: evt.chain,
      address: evt.address,
      type: evt.type,
      tx: evt.tx ?? null,
      block: evt.block ?? null,
      block_hash: evt.block_hash ?? null,
      log_index: evt.log_index ?? 0,
      ts,
      actor: evt.actor ?? null,
      payload: evt.payload ? JSON.stringify(evt.payload) : null,
      created_at: now(),
    });
  return info.changes > 0;
}

export function getToken(chain, address) {
  return db.prepare('SELECT * FROM tokens WHERE chain = ? AND address = ?').get(chain, address);
}

export function getTokenById(id) {
  return db.prepare('SELECT * FROM tokens WHERE id = ?').get(id);
}

export function tokenEvents(tokenId, limit = 50) {
  return db.prepare('SELECT * FROM token_events WHERE token_id = ? ORDER BY ts DESC, id DESC LIMIT ?').all(tokenId, limit);
}

export function touchWallet(chain, address, label) {
  if (!address) return;
  db.prepare(
    `INSERT INTO wallets (chain, address, label, first_seen_at, launch_count)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(chain, address) DO UPDATE SET label = COALESCE(wallets.label, excluded.label)`,
  ).run(chain, address, label ?? null, now());
}

export function bumpLaunchCount(chain, address) {
  if (!address) return;
  db.prepare('UPDATE wallets SET launch_count = launch_count + 1 WHERE chain = ? AND address = ?').run(chain, address);
}

export function setPool(tokenId, { dex, pool, quoteToken }) {
  db.prepare(
    `UPDATE tokens SET dex = COALESCE(@dex, dex), pool = COALESCE(@pool, pool),
      quote_token = COALESCE(@quote, quote_token), updated_at = @ts WHERE id = @id`,
  ).run({ dex: dex ?? null, pool: pool ?? null, quote: quoteToken ?? null, ts: now(), id: tokenId });
}

export function listTokens({ chain, stage, feed, search, limit = 50, offset = 0, sort = 'newest', minLiquidity = 0 } = {}) {
  const where = [];
  const params = {};
  if (chain) { where.push('chain = @chain'); params.chain = chain; }
  if (stage) { where.push('stage = @stage'); params.stage = stage; }
  if (feed) {
    const feedWhere = {
      deployments: `EXISTS (SELECT 1 FROM token_events e WHERE e.token_id = tokens.id AND e.type = 'deploy')`,
      launches: `EXISTS (SELECT 1 FROM token_events e WHERE e.token_id = tokens.id AND e.type IN ('launch','mint'))`,
      liquidity: `EXISTS (SELECT 1 FROM token_events e WHERE e.token_id = tokens.id AND e.type = 'liquidity')`,
      tradable: `stage IN ('trading','migrated')`,
      migrated: `stage = 'migrated'`,
      trending: `price IS NOT NULL`,
    }[feed];
    if (feedWhere) where.push(feedWhere);
  }
  if (search) {
    where.push('(LOWER(address) LIKE @q OR LOWER(COALESCE(name,\'\')) LIKE @q OR LOWER(COALESCE(symbol,\'\')) LIKE @q)');
    params.q = `%${search.toLowerCase()}%`;
  }
  if (minLiquidity) { where.push('COALESCE(liquidity_usd,0) >= @minLiq'); params.minLiq = minLiquidity; }
  const order = {
    newest: 'first_seen_at DESC',
    marketcap: 'COALESCE(market_cap,0) DESC',
    liquidity: 'COALESCE(liquidity_usd,0) DESC',
    volume: 'COALESCE(volume_usd,0) DESC',
    gainers: 'CASE WHEN baseline_price > 0 AND price > 0 THEN price/baseline_price ELSE 0 END DESC',
  }[sort] || 'first_seen_at DESC';
  params.limit = Math.min(Number(limit) || 50, 200);
  params.offset = Number(offset) || 0;
  const sql = `SELECT * FROM tokens ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT @limit OFFSET @offset`;
  const rows = db.prepare(sql).all(params);
  const total = db.prepare(`SELECT COUNT(*) c FROM tokens ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(params).c;
  return { rows, total };
}

export function feedEvents({ type, chain, limit = 40 } = {}) {
  const where = [];
  const params = { limit };
  if (type) { where.push('e.type = @type'); params.type = type; }
  if (chain) { where.push('e.chain = @chain'); params.chain = chain; }
  return db
    .prepare(
      `SELECT e.*, t.symbol, t.name, t.stage, t.market_cap, t.price, t.liquidity_usd, t.creator AS token_creator
       FROM token_events e LEFT JOIN tokens t ON t.id = e.token_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY e.ts DESC, e.id DESC LIMIT @limit`,
    )
    .all(params);
}

export function stats() {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS tokens,
        SUM(CASE WHEN first_seen_at > ? THEN 1 ELSE 0 END) AS last24h,
        SUM(CASE WHEN stage IN ('trading','migrated') THEN 1 ELSE 0 END) AS trading,
        SUM(CASE WHEN liquidity_usd IS NOT NULL THEN 1 ELSE 0 END) AS with_liquidity,
        SUM(COALESCE(volume_usd,0)) AS volume,
        SUM(COALESCE(liquidity_usd,0)) AS liquidity
       FROM tokens`,
    )
    .get(now() - 86400000);
  const events = db
    .prepare(
      `SELECT type, COUNT(*) c FROM token_events WHERE ts > ? GROUP BY type`,
    )
    .all(now() - 86400000);
  const byChain = db
    .prepare(`SELECT id AS chain, name, status, last_block, head_block, last_error, last_scan_at AS last FROM chains ORDER BY id`)
    .all();
  return { totals, events, byChain };
}

export function snapshotPrice(tokenId, { price, marketCap, liquidityUsd, source, ts }) {
  db.prepare(
    'INSERT INTO price_snapshots (token_id, ts, price, market_cap, liquidity_usd, source) VALUES (?,?,?,?,?,?)',
  ).run(tokenId, ts ?? now(), price ?? null, marketCap ?? null, liquidityUsd ?? null, source ?? null);
}

export function pruneSnapshots(tokenId, keep = 500) {
  db.prepare(
    `DELETE FROM price_snapshots WHERE token_id = ? AND id NOT IN
     (SELECT id FROM price_snapshots WHERE token_id = ? ORDER BY ts DESC LIMIT ?)`,
  ).run(tokenId, tokenId, keep);
}
