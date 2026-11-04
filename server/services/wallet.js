import { db, now } from '../db.js';
import { getClient } from '../chains/rpc.js';
import { chainById, SOLANA_AMM_PROGRAMS, SOLANA_PROGRAMS } from '../chains/registry.js';
import { getToken } from './tokens.js';
import { nativeUsd } from './pricing.js';
import { logLine } from '../chains/evm.js';

// Authentic wallet trade reconstruction from Solana transactions. We only record
// what the ledger proves: a token balance delta and a SOL balance delta in the
// same transaction that touched an AMM/launchpad program.

const LAMPORTS = 1e9;
const WSOL = 'So11111111111111111111111111111111111111112';
const TRACKING_PER_RUN = 4;

const ammIds = new Set([...SOLANA_AMM_PROGRAMS]);

function accountIndex(tx, address) {
  const keys = tx?.transaction?.message?.accountKeys || [];
  return keys.findIndex((k) => (typeof k === 'string' ? k : k.pubkey) === address);
}

function balanceDelta(tx, address) {
  const idx = accountIndex(tx, address);
  if (idx < 0) return 0;
  const pre = tx.meta?.preBalances?.[idx] ?? 0;
  const post = tx.meta?.postBalances?.[idx] ?? 0;
  return (post - pre) / LAMPORTS;
}

function tokenDeltas(tx, owner) {
  const map = new Map();
  for (const b of tx.meta?.preTokenBalances || []) {
    if (b.owner !== owner) continue;
    const amt = Number(b.uiTokenAmount?.uiAmountString ?? 0);
    map.set(b.mint, (map.get(b.mint) || 0) - amt);
  }
  for (const b of tx.meta?.postTokenBalances || []) {
    if (b.owner !== owner) continue;
    const amt = Number(b.uiTokenAmount?.uiAmountString ?? 0);
    map.set(b.mint, (map.get(b.mint) || 0) + amt);
  }
  return map;
}

function touchedAmm(tx) {
  const keys = tx?.transaction?.message?.accountKeys || [];
  for (const k of keys) {
    const id = typeof k === 'string' ? k : k.pubkey;
    if (ammIds.has(id)) return id;
  }
  const logs = (tx.meta?.logMessages || []).join(' ');
  for (const id of ammIds) if (logs.includes(id)) return id;
  return null;
}

export async function scanWallet(client, chain, address) {
  const sigs = await client.call('getSignaturesForAddress', [address, { limit: 20 }]);
  if (!sigs?.length) return { trades: 0 };
  let trades = 0;
  for (const s of [...sigs].reverse()) {
    if (s.err) continue;
    const existing = db
      .prepare('SELECT 1 FROM wallet_trades WHERE chain = ? AND tx = ? AND wallet = ? LIMIT 1')
      .get(chain.id, s.signature, address);
    if (existing) continue;
    let tx;
    try {
      tx = await client.call('getTransaction', [
        s.signature,
        { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed', commitment: 'confirmed' },
      ]);
    } catch (err) {
      logLine(chain.id, 'warn', 'wallet tx fetch failed', { error: err.message });
      continue;
    }
    if (!tx || tx.meta?.err) continue;
    const program = touchedAmm(tx);
    if (!program) continue; // only real AMM swaps, not transfers or mints
    const solDelta = balanceDelta(tx, address);
    const deltas = tokenDeltas(tx, address);
    const solUsd = nativeUsd(chain.id);
    const feeSol = (tx.meta?.fee ?? 0) / LAMPORTS;
    const ts = (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000;

    for (const [mint, delta] of deltas) {
      if (!delta || WSOL === mint || Math.abs(delta) < 1e-9) continue;
      const token = getToken(chain.id, mint);
      if (!token) continue; // only tokens the scanner actually discovered
      const side = delta > 0 ? 'buy' : 'sell';
      // The SOL leg is the opposing side of the swap.
      const quoteSol = Math.abs(solDelta) / Math.abs(delta);
      const price = solUsd ? quoteSol * solUsd : null;
      const info = db
        .prepare(
          `INSERT OR IGNORE INTO wallet_trades
             (chain, wallet, token_id, side, token_amount, price, quote_amount, fee_quote, tx, block, ts)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          chain.id,
          address,
          token.id,
          side,
          String(Math.abs(delta)),
          price,
          solUsd ? Math.abs(solDelta) * solUsd : null,
          solUsd ? feeSol * solUsd : null,
          s.signature,
          s.slot ?? null,
          ts,
        );
      if (info.changes > 0) trades += 1;
    }
  }
  return { trades };
}

/** Track fresh wallets plus creators with the most recent launches. */
export async function trackWalletActivity(maxWallets = TRACKING_PER_RUN) {
  const wallets = db
    .prepare(
      `SELECT chain, address FROM wallets WHERE chain = 'solana'
       ORDER BY first_seen_at DESC LIMIT ?`,
    )
    .all(maxWallets);
  if (!wallets.length) return { wallets: 0 };
  const chain = chainById('solana');
  const client = getClient(chain);
  if (!client) return { wallets: 0 };
  let trades = 0;
  for (const w of wallets) {
    try {
      const res = await scanWallet(client, chain, w.address);
      trades += res.trades || 0;
    } catch (err) {
      logLine(chain.id, 'warn', 'wallet scan failed', { address: w.address, error: err.message });
    }
  }
  if (trades) logLine(chain.id, 'info', 'wallet trades recorded', { trades, at: now() });
  return { wallets: wallets.length, trades };
}
