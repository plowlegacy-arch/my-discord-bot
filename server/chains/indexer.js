import { db, now } from '../db.js';
import { CHAINS, chainById, isEnabled, liveChains } from './registry.js';
import { discoverEvmTokens, logLine } from './evm.js';
import { discoverSolanaTokens } from './solana.js';
import { refreshNativePrices } from '../services/pricing.js';
import { analyzeAllPending } from '../services/security.js';
import { priceSolanaTokens } from '../services/solanaPrice.js';
import { trackWalletActivity } from '../services/wallet.js';

// Orchestrates every chain pipeline independently: each chain keeps its own
// cursor, error state and backoff so one unhealthy RPC cannot stall the rest.

const state = new Map();
const SOLANA_TICK_MS = 20000;
const EVM_TICK_MS = 12000;

function ensureChainRows() {
  for (const chain of CHAINS) {
    db.prepare(
      `INSERT INTO chains (id, name, family, native_symbol, status, rpc_env, block_time_ms, created_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, family = excluded.family,
         native_symbol = excluded.native_symbol, rpc_env = excluded.rpc_env, block_time_ms = excluded.block_time_ms`,
    ).run(chain.id, chain.name, chain.family, chain.nativeSymbol, chain.status, chain.rpcEnv, chain.blockTimeMs || 1200, now());
  }
}

function chainStatus(chainId, patch) {
  const fields = Object.keys(patch);
  if (!fields.length) return;
  db.prepare(`UPDATE chains SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`).run({ ...patch, id: chainId });
}

function s(chainId) {
  if (!state.has(chainId)) state.set(chainId, { busy: false, failures: 0, nextAt: 0, lastMs: null, lastResult: null });
  return state.get(chainId);
}

async function tickChain(chain) {
  const st = s(chain.id);
  if (st.busy || Date.now() < st.nextAt) return;
  st.busy = true;
  const started = Date.now();
  try {
    const result = chain.family === 'solana' ? await discoverSolanaTokens() : await discoverEvmTokens(chain);
    st.failures = 0;
    st.lastResult = result;
    st.nextAt = Date.now() + (chain.family === 'solana' ? SOLANA_TICK_MS : EVM_TICK_MS);
    if (!result?.skipped) chainStatus(chain.id, { status: 'live', last_error: null });
  } catch (err) {
    st.failures += 1;
    const backoff = Math.min(120000, 3000 * 2 ** st.failures);
    st.nextAt = Date.now() + backoff;
    chainStatus(chain.id, { status: st.failures > 3 ? 'degraded' : 'retrying', last_error: String(err.message || err).slice(0, 400) });
    logLine(chain.id, 'error', 'discovery tick failed', { error: err.message, failures: st.failures, backoff });
  } finally {
    st.lastMs = Date.now() - started;
    st.busy = false;
  }
}

let timers = [];
let running = false;

export function indexerState() {
  return CHAINS.map((c) => {
    const st = s(c.id);
    const row = db.prepare('SELECT * FROM chains WHERE id = ?').get(c.id) || {};
    return {
      ...row,
      configured: isEnabled(c),
      family: c.family,
      live: c.status === 'live',
      rpc_env: c.rpcEnv,
      busy: st.busy,
      failures: st.failures,
      last_tick_ms: st.lastMs,
      next_tick_at: st.nextAt,
      note: c.note || null,
    };
  });
}

async function maintenance() {
  try {
    await refreshNativePrices();
  } catch { /* logged inside pricing */ }
  try {
    await priceSolanaTokens(30);
  } catch (err) {
    logLine('solana', 'warn', 'supplementary pricing failed', { error: err.message });
  }
  try {
    analyzeAllPending(20);
  } catch (err) {
    logLine('global', 'warn', 'security analysis failed', { error: err.message });
  }
  try {
    await trackWalletActivity();
  } catch (err) {
    logLine('global', 'warn', 'wallet tracking failed', { error: err.message });
  }
}

export function startIndexer() {
  if (running) return;
  running = true;
  ensureChainRows();
  const active = liveChains().filter((c) => isEnabled(c));
  logLine('global', 'info', 'indexer starting', { chains: active.map((c) => c.id), total: CHAINS.length });

  // Per-chain loops: independent intervals, no shared await chain.
  for (const chain of active) {
    const period = chain.family === 'solana' ? SOLANA_TICK_MS : EVM_TICK_MS;
    const timer = setInterval(() => tickChain(chain).catch(() => {}), period);
    timers.push(timer);
    setTimeout(() => tickChain(chain).catch(() => {}), 500);
  }
  const maintTimer = setInterval(() => maintenance().catch(() => {}), 45000);
  timers.push(maintTimer);
  setTimeout(() => maintenance().catch(() => {}), 4000);
}

export function stopIndexer() {
  for (const t of timers) clearInterval(t);
  timers = [];
  running = false;
}

/** One-off manual scan used by the dashboard "scan now" control. */
export async function triggerScan(chainId) {
  const chain = chainById(chainId);
  if (!chain) throw new Error('unknown chain');
  if (!isEnabled(chain)) throw new Error('no RPC configured for this chain');
  if (chain.status !== 'live') throw new Error(`${chain.name} pipeline is not implemented yet`);
  await tickChain(chain);
  return s(chain.id).lastResult;
}

export function indexerLogs({ chain, limit = 60 } = {}) {
  const sql = chain
    ? 'SELECT * FROM indexer_log WHERE chain = ? ORDER BY ts DESC LIMIT ?'
    : 'SELECT * FROM indexer_log ORDER BY ts DESC LIMIT ?';
  return chain ? db.prepare(sql).all(chain, limit) : db.prepare(sql).all(limit);
}
