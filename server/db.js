import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'trench.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 8000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  family TEXT NOT NULL,
  native_symbol TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  rpc_env TEXT,
  last_block INTEGER,
  last_block_hash TEXT,
  head_block INTEGER,
  last_error TEXT,
  last_scan_at INTEGER,
  block_time_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cursors (
  chain TEXT NOT NULL,
  stream TEXT NOT NULL,
  value TEXT,
  extra TEXT,
  updated_at INTEGER,
  PRIMARY KEY (chain, stream)
);

CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  name TEXT,
  symbol TEXT,
  decimals INTEGER,
  creator TEXT,
  deploy_tx TEXT,
  deploy_block INTEGER,
  deploy_hash TEXT,
  created_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  initial_supply TEXT,
  total_supply TEXT,
  launchpad TEXT,
  dex TEXT,
  pool TEXT,
  quote_token TEXT,
  stage TEXT NOT NULL DEFAULT 'deployed',
  verified INTEGER NOT NULL DEFAULT 0,
  holders INTEGER,
  metadata TEXT,
  first_deploy_price REAL,
  first_liquidity_price REAL,
  first_observed_price REAL,
  baseline_price REAL,
  baseline_source TEXT,
  baseline_at INTEGER,
  price REAL,
  price_source TEXT,
  market_cap REAL,
  liquidity_usd REAL,
  volume_usd REAL,
  buys INTEGER NOT NULL DEFAULT 0,
  sells INTEGER NOT NULL DEFAULT 0,
  ath_price REAL,
  ath_at INTEGER,
  low_price REAL,
  low_at INTEGER,
  last_price_at INTEGER,
  graduated_at INTEGER,
  risk_score INTEGER,
  risk_level TEXT,
  risk_report TEXT,
  security_checked_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(chain, address)
);
CREATE INDEX IF NOT EXISTS idx_tokens_chain_seen ON tokens(chain, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_stage ON tokens(stage, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_creator ON tokens(chain, creator);
CREATE INDEX IF NOT EXISTS idx_tokens_mc ON tokens(market_cap DESC);

CREATE TABLE IF NOT EXISTS token_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  type TEXT NOT NULL,
  tx TEXT,
  block INTEGER,
  block_hash TEXT,
  log_index INTEGER,
  ts INTEGER,
  actor TEXT,
  payload TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(chain, tx, log_index, type, address)
);
CREATE INDEX IF NOT EXISTS idx_events_token ON token_events(token_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON token_events(type, ts DESC);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  price REAL,
  market_cap REAL,
  liquidity_usd REAL,
  source TEXT,
  FOREIGN KEY(token_id) REFERENCES tokens(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_snap_token ON price_snapshots(token_id, ts DESC);

CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER NOT NULL,
  multiple REAL NOT NULL,
  basis TEXT NOT NULL DEFAULT 'price',
  price REAL,
  market_cap REAL,
  reached_at INTEGER NOT NULL,
  seconds_since_baseline INTEGER,
  UNIQUE(token_id, multiple, basis)
);
CREATE INDEX IF NOT EXISTS idx_milestones_ts ON milestones(reached_at DESC);

CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  label TEXT,
  first_seen_at INTEGER NOT NULL,
  launch_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(chain, address)
);

CREATE TABLE IF NOT EXISTS wallet_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  wallet TEXT NOT NULL,
  token_id INTEGER NOT NULL,
  side TEXT NOT NULL,
  token_amount TEXT NOT NULL,
  price REAL,
  quote_amount REAL,
  fee_quote REAL,
  tx TEXT NOT NULL,
  block INTEGER,
  ts INTEGER NOT NULL,
  UNIQUE(chain, tx, wallet, token_id, side)
);
CREATE INDEX IF NOT EXISTS idx_wtrades_wallet ON wallet_trades(chain, wallet, ts DESC);

CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  currency_name TEXT NOT NULL DEFAULT 'Trench Coin',
  currency_symbol TEXT NOT NULL DEFAULT '⛏',
  starting_balance INTEGER NOT NULL DEFAULT 2500,
  daily_amount INTEGER NOT NULL DEFAULT 1000,
  weekly_amount INTEGER NOT NULL DEFAULT 5000,
  monthly_amount INTEGER NOT NULL DEFAULT 20000,
  work_cooldown INTEGER NOT NULL DEFAULT 3600,
  max_bet INTEGER NOT NULL DEFAULT 1000000,
  min_bet INTEGER NOT NULL DEFAULT 10,
  owner_role_ids TEXT NOT NULL DEFAULT '[]',
  admin_role_ids TEXT NOT NULL DEFAULT '[]',
  alert_channel TEXT,
  min_alert_liquidity REAL DEFAULT 0,
  min_alert_marketcap REAL DEFAULT 0,
  multiplier_alerts INTEGER NOT NULL DEFAULT 1,
  tracked_chains TEXT NOT NULL DEFAULT '[]',
  theme TEXT NOT NULL DEFAULT 'solana',
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS econ_users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  cash INTEGER NOT NULL DEFAULT 0,
  bank INTEGER NOT NULL DEFAULT 0,
  bank_capacity INTEGER NOT NULL DEFAULT 25000,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  energy INTEGER NOT NULL DEFAULT 100,
  career TEXT,
  career_level INTEGER NOT NULL DEFAULT 1,
  career_xp INTEGER NOT NULL DEFAULT 0,
  career_cooldown INTEGER NOT NULL DEFAULT 0,
  last_daily INTEGER,
  last_weekly INTEGER,
  last_monthly INTEGER,
  last_work INTEGER,
  streak INTEGER NOT NULL DEFAULT 0,
  married_to TEXT,
  house TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  meta TEXT,
  acquired_at INTEGER NOT NULL,
  UNIQUE(guild_id, user_id, item_key)
);

CREATE TABLE IF NOT EXISTS market_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  qty INTEGER NOT NULL,
  price INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fixed',
  status TEXT NOT NULL DEFAULT 'open',
  buyer_id TEXT,
  ends_at INTEGER,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_listings_guild ON market_listings(guild_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS econ_tx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL,
  balance_after INTEGER,
  ref TEXT,
  meta TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_etx_user ON econ_tx(guild_id, user_id, ts DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_etx_ref ON econ_tx(guild_id, user_id, ref) WHERE ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  amount INTEGER,
  meta TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_guild ON audit_log(guild_id, ts DESC);

CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  staff INTEGER NOT NULL DEFAULT 0,
  upkeep_paid_until INTEGER,
  last_collect INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_owner ON businesses(guild_id, owner_id);

CREATE TABLE IF NOT EXISTS casino_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,
  wager INTEGER NOT NULL,
  payout INTEGER NOT NULL,
  detail TEXT,
  server_seed_hash TEXT,
  client_seed TEXT,
  nonce INTEGER,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bets_user ON casino_bets(guild_id, user_id, ts DESC);

CREATE TABLE IF NOT EXISTS casino_seeds (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  client_seed TEXT NOT NULL,
  nonce INTEGER NOT NULL DEFAULT 0,
  revealed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  host_id TEXT NOT NULL,
  prize TEXT NOT NULL,
  prize_kind TEXT NOT NULL DEFAULT 'currency',
  prize_amount INTEGER,
  prize_item TEXT,
  winners INTEGER NOT NULL DEFAULT 1,
  requirements TEXT,
  entries TEXT NOT NULL DEFAULT '[]',
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  winner_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_giveaway_guild ON giveaways(guild_id, status, ends_at);

CREATE TABLE IF NOT EXISTS lottery_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  pot INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  winner_id TEXT,
  ends_at INTEGER,
  drawn_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lottery_guild ON lottery_rounds(guild_id, status);

CREATE TABLE IF NOT EXISTS lottery_tickets (
  guild_id TEXT NOT NULL,
  round_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  tickets INTEGER NOT NULL DEFAULT 0,
  bought_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, round_id, user_id)
);

CREATE TABLE IF NOT EXISTS achievements (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, key)
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  acquired_at INTEGER NOT NULL,
  UNIQUE(guild_id, user_id, kind, key)
);

CREATE TABLE IF NOT EXISTS alerts_sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  ref TEXT NOT NULL,
  ts INTEGER NOT NULL,
  UNIQUE(topic, ref)
);

CREATE TABLE IF NOT EXISTS indexer_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ilog_chain ON indexer_log(chain, ts DESC);
`;

export function initSchema() {
  db.exec(SCHEMA);
}

export const now = () => Date.now();
