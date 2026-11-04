import { db, now } from '../db.js';
import { getClient } from './rpc.js';
import { SOLANA_PROGRAMS, SOLANA_AMM_PROGRAMS, SOLANA_LAUNCH_PROGRAMS } from './registry.js';
import { logLine, getCursor, setCursor } from './evm.js';
import {
  upsertToken, getToken, recordEvent, advanceStage, touchWallet, bumpLaunchCount, setPool, getTokenById,
} from '../services/tokens.js';
import { onTokenEvent } from '../services/tracker.js';

// Solana discovery is driven purely by on-chain data:
//  - getSignaturesForAddress on launchpad / AMM programs to enumerate real activity
//  - getTransaction (jsonParsed) to read mint creation and pool instructions
// No screener or listing API is consulted to decide that a token exists.

const LAMPORTS = 1e9;

function chainRow() {
  return db.prepare('SELECT * FROM chains WHERE id = ?').get('solana');
}

function ensureChainRow() {
  return (
    db.prepare('SELECT * FROM chains WHERE id = ?').get('solana') ||
    db
      .prepare(
        `INSERT INTO chains (id, name, family, native_symbol, status, rpc_env, block_time_ms, created_at)
         VALUES ('solana','Solana','solana','SOL','live','RPC_URL_SOLANA',400,?) RETURNING *`,
      )
      .get(now())
  );
}

function setChainState(patch) {
  const fields = Object.keys(patch);
  if (!fields.length) return;
  db.prepare(`UPDATE chains SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = 'solana'`).run(patch);
}

const PROGRAM_LABELS = Object.fromEntries(
  Object.entries(SOLANA_PROGRAMS).map(([key, id]) => [id, key]),
);

/** Extract every SPL mint referenced by a parsed transaction. */
function mintsInTx(tx) {
  const mints = new Set();
  const message = tx?.transaction?.message;
  for (const ix of message?.instructions || []) {
    const info = ix.parsed?.info;
    if (ix.program === 'spl-token' || ix.programId === SOLANA_PROGRAMS.token || ix.programId === SOLANA_PROGRAMS.token2022) {
      if (info?.mint) mints.add(info.mint);
    }
  }
  for (const inner of tx?.meta?.innerInstructions || []) {
    for (const ix of inner.instructions || []) {
      const info = ix.parsed?.info;
      if (info?.mint) mints.add(info.mint);
    }
  }
  for (const b of tx?.meta?.postTokenBalances || []) if (b.mint) mints.add(b.mint);
  return [...mints];
}

function mintInitialization(tx) {
  for (const ix of tx?.transaction?.message?.instructions || []) {
    if (ix.parsed?.type === 'initializeMint' || ix.parsed?.type === 'initializeMint2') return ix.parsed.info;
  }
  for (const inner of tx?.meta?.innerInstructions || []) {
    for (const ix of inner.instructions || []) {
      if (ix.parsed?.type === 'initializeMint' || ix.parsed?.type === 'initializeMint2') return ix.parsed.info;
    }
  }
  return null;
}

async function mintAccountInfo(client, mint) {
  try {
    const res = await client.call('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
    const info = res?.value?.data?.parsed?.info;
    if (!info) return null;
    return {
      decimals: info.decimals ?? null,
      supply: info.supply ?? null,
      mintAuthority: info.mintAuthority ?? null,
      freezeAuthority: info.freezeAuthority ?? null,
      owner: res.value.owner,
    };
  } catch {
    return null;
  }
}

/** Scan one program's recent signatures and record what it proves on-chain. */
async function scanProgram(client, programId, kind) {
  const stream = `sig:${programId}`;
  const cursor = getCursor('solana', stream);
  const sigs = await client.call('getSignaturesForAddress', [
    programId,
    { limit: 25, ...(cursor.value ? { until: cursor.value } : {}) },
  ]);
  if (!sigs?.length) return { scanned: 0, tokens: 0 };
  let tokens = 0;
  // Oldest first so cursors advance monotonically.
  const ordered = [...sigs].reverse();
  for (const s of ordered) {
    if (s.err) continue;
    const seen = db
      .prepare('SELECT 1 FROM token_events WHERE chain = ? AND tx = ? LIMIT 1')
      .get('solana', s.signature);
    if (seen) continue;
    let tx;
    try {
      tx = await client.call('getTransaction', [
        s.signature,
        { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed', commitment: 'confirmed' },
      ]);
    } catch (err) {
      logLine('solana', 'warn', 'getTransaction failed', { sig: s.signature, error: err.message });
      continue;
    }
    if (!tx || tx.meta?.err) continue;
    const ts = (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000;
    const feePayer = tx.transaction?.message?.accountKeys?.[0]?.pubkey || tx.transaction?.message?.accountKeys?.[0] || null;
    const mints = mintsInTx(tx);
    if (!mints.length) continue;
    const init = mintInitialization(tx);
    const isLaunch = Boolean(SOLANA_LAUNCH_PROGRAMS[programId]);
    const isAmm = SOLANA_AMM_PROGRAMS.has(programId);
    const launchMeta = SOLANA_LAUNCH_PROGRAMS[programId] || null;

    // The mint this transaction is really about: the freshly initialized one, else the
    // highest-supply mint touched (quote mints such as WSOL/USDC are ignored).
    const ignored = new Set([
      'So11111111111111111111111111111111111111112',
      'EPjFWdd5AufqSSqeM2qN1xzyBpXGDzNrQnTrgPX5Sq',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    ]);
    const candidates = mints.filter((m) => !ignored.has(m));
    if (!candidates.length) continue;
    const primary = init?.mint && candidates.includes(init.mint) ? init.mint : candidates[0];

    const info = await mintAccountInfo(client, primary);
    const existing = getToken('solana', primary);
    let token = existing;
    if (!token) {
      token = upsertToken({
        chain: 'solana',
        address: primary,
        creator: feePayer,
        deploy_tx: s.signature,
        deploy_block: s.slot ?? null,
        created_at: ts,
        first_seen_at: now(),
        initial_supply: info?.supply ?? init?.supply ?? null,
        total_supply: info?.supply ?? null,
        decimals: info?.decimals ?? init?.decimals ?? null,
        launchpad: launchMeta?.name || null,
        dex: isAmm ? PROGRAM_LABELS[programId] || 'amm' : null,
        stage: isLaunch ? 'launched' : isAmm ? 'liquid' : 'minted',
        metadata: {
          discovered_via: isLaunch ? 'launchpad-program' : isAmm ? 'amm-program' : 'spl-mint',
          mintAuthority: info?.mintAuthority ?? init?.mintAuthority ?? null,
          freezeAuthority: info?.freezeAuthority ?? init?.freezeAuthority ?? null,
          program: PROGRAM_LABELS[programId] || programId,
        },
      });
      tokens += 1;
      if (feePayer) {
        touchWallet('solana', feePayer);
      }
    } else if (info) {
      db.prepare(
        `UPDATE tokens SET total_supply = COALESCE(?, total_supply), decimals = COALESCE(decimals, ?), updated_at = ?
         WHERE id = ?`,
      ).run(info.supply ?? null, info.decimals ?? null, now(), token.id);
    }

    const eventType = isAmm ? 'liquidity' : isLaunch ? 'launch' : init ? 'mint' : 'trading';
    const inserted = recordEvent({
      token_id: token.id,
      chain: 'solana',
      address: primary,
      type: eventType,
      tx: s.signature,
      block: s.slot ?? null,
      log_index: 0,
      ts,
      actor: feePayer,
      payload: { program: PROGRAM_LABELS[programId] || programId, kind, mints: candidates.slice(0, 6) },
    });
    if (!existing && init) {
      recordEvent({
        token_id: token.id, chain: 'solana', address: primary, type: 'mint', tx: s.signature,
        block: s.slot ?? null, log_index: 1, ts, actor: feePayer,
        payload: { reason: 'initializeMint', supply: init.supply ?? null },
      });
    }
    if (isAmm) setPool(token.id, { dex: PROGRAM_LABELS[programId] || 'amm', pool: programId, quoteToken: null });
    advanceStage(getTokenById(token.id), isAmm ? 'liquid' : isLaunch ? 'launched' : 'minted');
    if (inserted) {
      if (eventType === 'launch' && feePayer) bumpLaunchCount('solana', feePayer);
      onTokenEvent({ kind: eventType === 'mint' ? 'mint' : eventType, token: getTokenById(token.id), chain: { id: 'solana', name: 'Solana' } });
    }
  }
  setCursor('solana', stream, ordered[ordered.length - 1].signature, { slot: ordered[ordered.length - 1].slot });
  return { scanned: ordered.length, tokens };
}

export async function discoverSolanaTokens() {
  const client = getClient({ id: 'solana', family: 'solana', rpcEnv: 'RPC_URL_SOLANA', defaultRpc: 'https://api.mainnet-beta.solana.com' });
  if (!client) return { skipped: 'no rpc' };
  ensureChainRow();
  const slot = await client.call('getSlot', [{ commitment: 'confirmed' }]);
  setChainState({ head_block: slot, status: 'live', last_error: null });

  const targets = [
    [SOLANA_PROGRAMS.pumpFun, 'launchpad'],
    [SOLANA_PROGRAMS.raydiumLaunchpad, 'launchpad'],
    [SOLANA_PROGRAMS.meteoraDbc, 'bonding-curve'],
    [SOLANA_PROGRAMS.raydiumAmmV4, 'amm-pool'],
    [SOLANA_PROGRAMS.pumpAmm, 'amm-pool'],
    [SOLANA_PROGRAMS.meteoraDlmm, 'amm-pool'],
    [SOLANA_PROGRAMS.orcaWhirlpool, 'amm-pool'],
  ];
  let total = 0;
  for (const [programId, kind] of targets) {
    try {
      const res = await scanProgram(client, programId, kind);
      total += res.tokens || 0;
    } catch (err) {
      logLine('solana', 'warn', `program scan failed: ${kind}`, { programId, error: err.message });
      setChainState({ last_error: err.message });
    }
  }
  setChainState({ last_block: slot, last_scan_at: now(), last_block_hash: null });
  return { head: slot, newTokens: total };
}
