import { db, now } from '../db.js';
import { getClient } from './rpc.js';
import { TOPICS, SEL, decodeAddress, decodeString, decodeUint } from './abi.js';
import { explorerToken } from './registry.js';
import {
  upsertToken, getToken, recordEvent, advanceStage, touchWallet, bumpLaunchCount, setPool,
  snapshotPrice, pruneSnapshots, getTokenById,
} from '../services/tokens.js';
import { quoteUsd, priceFromReserves, nativeUsd } from '../services/pricing.js';
import { onTokenEvent, onTokensUpdated } from '../services/tracker.js';

const hex = (n) => '0x' + Number(n).toString(16);
const unhex = (s) => parseInt(s, 16);
const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = '0x000000000000000000000000000000000000dEaD';

export function getCursor(chainId, stream) {
  const row = db.prepare('SELECT * FROM cursors WHERE chain = ? AND stream = ?').get(chainId, stream);
  return row ? { value: row.value, extra: row.extra ? JSON.parse(row.extra) : null } : { value: null, extra: null };
}

export function setCursor(chainId, stream, value, extra) {
  db.prepare(
    `INSERT INTO cursors (chain, stream, value, extra, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(chain, stream) DO UPDATE SET value = excluded.value, extra = excluded.extra, updated_at = excluded.updated_at`,
  ).run(chainId, stream, String(value), extra ? JSON.stringify(extra) : null, now());
}

export function logLine(chain, level, message, meta) {
  db.prepare('INSERT INTO indexer_log (chain, level, message, meta, ts) VALUES (?,?,?,?,?)').run(
    chain, level, message, meta ? JSON.stringify(meta).slice(0, 4000) : null, now(),
  );
}

const chainRow = (chain) =>
  db.prepare('SELECT * FROM chains WHERE id = ?').get(chain.id) ||
  db
    .prepare(
      `INSERT INTO chains (id, name, family, native_symbol, status, rpc_env, block_time_ms, created_at)
       VALUES (?,?,?,?,?,?,?,?) RETURNING *`,
    )
    .get(chain.id, chain.name, chain.family, chain.nativeSymbol, chain.status, chain.rpcEnv, chain.blockTimeMs, now());

function setChainState(chainId, patch) {
  const fields = Object.keys(patch);
  if (!fields.length) return;
  const sql = `UPDATE chains SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`;
  db.prepare(sql).run({ ...patch, id: chainId });
}

async function ethCall(client, block, to, data) {
  const res = await client.call('eth_call', [{ to, data }, block]);
  return res;
}

async function readErc20(client, block, address) {
  const methods = [
    ['name', SEL.name], ['symbol', SEL.symbol], ['decimals', SEL.decimals], ['totalSupply', SEL.totalSupply],
  ];
  const out = await client.batch(methods.map(([, sel]) => ({ method: 'eth_call', params: [{ to: address, data: sel }, block] })));
  const meta = { name: null, symbol: null, decimals: null, totalSupply: null };
  const [n, s, d, t] = out.map((r) => r.result);
  meta.name = decodeString(n);
  meta.symbol = decodeString(s);
  const dec = decodeUint(d);
  meta.decimals = dec != null ? Number(dec) : null;
  const supply = decodeUint(t);
  meta.totalSupply = supply != null ? supply.toString() : null;
  if (meta.decimals === null || meta.decimals > 36) meta.decimals = meta.decimals ?? null;
  return meta;
}

// Detect EIP-1167 minimal proxy + EIP-1967 implementation slot (upgradeable risk).
async function proxyInfo(client, block, address) {
  const code = await client.call('eth_getCode', [address, block]).catch(() => '0x');
  const minimalProxy = /^0x363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3$/i.test(code);
  const implSlot = await client
    .call('eth_getStorageAt', [address, '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc', block])
    .catch(() => '0x0');
  const impl = implSlot && implSlot !== '0x' ? decodeAddress(implSlot) : null;
  const hasImpl = impl && impl !== ZERO;
  return { minimalProxy, implementation: hasImpl ? impl : null, bytecodeSize: code ? (code.length - 2) / 2 : 0 };
}

export async function discoverEvmTokens(chain, { maxBlocks } = {}) {
  const client = getClient(chain);
  if (!client) return { skipped: 'no rpc' };
  const row = chainRow(chain);
  const headHex = await client.call('eth_blockNumber');
  const head = unhex(headHex);
  setChainState(chain.id, { head_block: head, status: 'live', last_error: null });

  let cursor = getCursor(chain.id, 'blocks');
  let from;
  const stored = cursor.value ? Number(cursor.value) : null;
  if (stored == null) {
    const lookback = chain.startLookback || 30;
    from = Math.max(1, head - lookback);
  } else {
    // Reorg detection: the block we last committed must still exist with the same hash.
    let reorgRewind = 0;
    if (cursor.extra?.hash) {
      const check = await client.call('eth_getBlockByNumber', [hex(stored), false]).catch(() => null);
      if (!check || check.hash !== cursor.extra.hash) reorgRewind = Math.min(64, Math.max(4, (chain.maxBlocksPerTick || 3)));
    }
    if (reorgRewind) {
      const rewindTo = Math.max(1, stored - reorgRewind);
      db.prepare('DELETE FROM token_events WHERE chain = ? AND block > ?').run(chain.id, rewindTo);
      logLine(chain.id, 'warn', 'reorg detected, rewinding', { from: stored, to: rewindTo });
      from = rewindTo;
    } else {
      from = stored + 1;
    }
  }
  const limit = maxBlocks || chain.maxBlocksPerTick || 3;
  const to = Math.min(head, from + limit - 1);
  if (to < from) {
    setChainState(chain.id, { last_scan_at: now(), last_block: stored ?? head });
    return { upToDate: true, head };
  }

  const blocks = [];
  const batch = await client.batch(
    Array.from({ length: to - from + 1 }, (_, i) => ({
      method: 'eth_getBlockByNumber',
      params: [hex(from + i), true],
    })),
  );
  for (const r of batch) if (r.result) blocks.push(r.result);

  const deployments = [];
  const blockTimes = new Map();
  for (const b of blocks) {
    const ts = unhex(b.timestamp) * 1000;
    blockTimes.set(unhex(b.number), ts);
    for (const tx of b.transactions || []) {
      if (tx.to === null || tx.to === undefined) {
        deployments.push({ hash: tx.hash, from: tx.from, block: unhex(b.number), blockHash: b.hash, ts, input: tx.input });
      }
    }
  }

  let newTokens = 0;
  if (deployments.length) {
    const receipts = await client.batch(
      deployments.map((d) => ({ method: 'eth_getTransactionReceipt', params: [d.hash] })),
    );
    const verified = [];
    for (let i = 0; i < deployments.length; i++) {
      const dep = deployments[i];
      const rc = receipts[i]?.result;
      if (!rc || !rc.contractAddress) continue;
      const address = rc.contractAddress;
      // A token contract must actually emit an ERC-20 Transfer/Mint event or expose decimals().
      const meta = await readErc20(client, hex(dep.block), address);
      const hasTransfer = (rc.logs || []).some(
        (l) => l.topics?.[0] === TOPICS.Transfer && l.address?.toLowerCase() === address.toLowerCase(),
      );
      if (meta.decimals === null && !hasTransfer) continue;
      if (!meta.symbol && !meta.name && !hasTransfer) continue;
      verified.push({ dep, address, meta, hasTransfer });
    }

    for (const { dep, address, meta, hasTransfer } of verified) {
      const existing = getToken(chain.id, address);
      const token = upsertToken({
        chain: chain.id,
        address,
        name: meta.name || null,
        symbol: meta.symbol || null,
        decimals: meta.decimals,
        creator: dep.from,
        deploy_tx: dep.hash,
        deploy_block: dep.block,
        deploy_hash: dep.blockHash,
        created_at: dep.ts,
        first_seen_at: now(),
        initial_supply: meta.totalSupply,
        total_supply: meta.totalSupply,
        stage: 'deployed',
        metadata: { erc20: hasTransfer, discovered_via: 'block-scan' },
      });
      if (!existing) newTokens += 1;
      const inserted = recordEvent({
        token_id: token.id, chain: chain.id, address, type: 'deploy', tx: dep.hash,
        block: dep.block, block_hash: dep.blockHash, log_index: 0, ts: dep.ts, actor: dep.from,
        payload: { creator: dep.from, supply: meta.totalSupply },
      });
      touchWallet(chain.id, dep.from);
      if (inserted) {
        bumpLaunchCount(chain.id, dep.from);
        onTokenEvent({ kind: 'deploy', token: getTokenById(token.id), chain });
      }
      // Any mint event in the deployment receipt distinguishes a "minted" supply event.
      if ((rc?.logs || []).length) {
        recordEvent({
          token_id: token.id, chain: chain.id, address, type: 'mint', tx: dep.hash,
          block: dep.block, block_hash: dep.blockHash, log_index: 1, ts: dep.ts, actor: dep.from,
          payload: { reason: 'initial-supply' },
        });
      }
    }
  }

  // DEX factory pool creations in this block range → real first-liquidity events.
  if (chain.factories?.length && to - from <= 5000) {
    const addrs = chain.factories.map((f) => f.address);
    let logs = [];
    try {
      logs = await client.call('eth_getLogs', [
        {
          fromBlock: hex(from),
          toBlock: hex(to),
          address: addrs,
          topics: [[TOPICS.PairCreated, TOPICS.PoolCreated, TOPICS.TokenCreate]],
        },
      ]);
    } catch (err) {
      logLine(chain.id, 'warn', 'factory log query failed', { error: err.message });
    }
    for (const lg of logs || []) {
      const factory = chain.factories.find((f) => f.address.toLowerCase() === lg.address?.toLowerCase());
      if (!factory) continue;
      let tokenA = null;
      let tokenB = null;
      let pool = null;
      let kind = factory.kind;
      if (lg.topics[0] === TOPICS.PairCreated) {
        tokenA = decodeAddress(lg.topics[1]);
        tokenB = decodeAddress(lg.topics[2]);
        pool = decodeAddress(lg.topics[3] || lg.data.slice(0, 66));
      } else if (lg.topics[0] === TOPICS.PoolCreated) {
        tokenA = decodeAddress(lg.topics[1]);
        tokenB = decodeAddress(lg.topics[2]);
        pool = decodeAddress(lg.data.slice(2 + 64 * 2, 2 + 64 * 3));
        kind = 'v3';
      } else {
        const words = lg.data.slice(2).match(/.{64}/g) || [];
        tokenA = decodeAddress('0x' + (words[0] || ''));
        tokenB = null;
        pool = decodeAddress(lg.topics[1]);
      }
      const blockNum = unhex(lg.blockNumber);
      const ts = blockTimes.get(blockNum) ?? Date.now();
      const quoteSet = new Set([
        ...(chain.stableTokens || []).map((a) => a.toLowerCase()),
        ...(chain.wrappedNative ? [chain.wrappedNative.toLowerCase()] : []),
      ]);
      const tokenAddr = quoteSet.has(tokenA?.toLowerCase()) ? tokenB : tokenA;
      if (!tokenAddr || quoteSet.has(tokenAddr.toLowerCase())) continue;
      const quote = quoteSet.has((tokenB || '').toLowerCase()) ? tokenB : tokenA;
      const existing = getToken(chain.id, tokenAddr);
      let token = existing;
      if (!token) {
        const meta = await readErc20(client, hex(blockNum), tokenAddr).catch(() => ({}));
        if (meta.decimals == null && !meta.symbol) continue;
        token = upsertToken({
          chain: chain.id, address: tokenAddr, name: meta.name || null, symbol: meta.symbol || null,
          decimals: meta.decimals, created_at: ts, first_seen_at: now(), total_supply: meta.totalSupply,
          stage: 'liquid', dex: factory.name, pool, quote_token: quote,
          metadata: { discovered_via: 'dex-factory' },
        });
        const depTx = await client
          .call('eth_getTransactionByHash', [lg.transactionHash])
          .catch(() => null);
        if (depTx?.from) {
          db.prepare('UPDATE tokens SET creator = COALESCE(creator, ?) WHERE id = ?').run(depTx.from, token.id);
          touchWallet(chain.id, depTx.from);
        }
        newTokens += 1;
      }
      setPool(token.id, { dex: factory.name, pool, quoteToken: quote });
      advanceStage(token, 'liquid');
      const inserted = recordEvent({
        token_id: token.id, chain: chain.id, address: tokenAddr, type: 'liquidity', tx: lg.transactionHash,
        block: blockNum, block_hash: lg.blockHash, log_index: unhex(lg.logIndex), ts, actor: null,
        payload: { dex: factory.name, pool, quote, kind },
      });
      if (inserted) onTokenEvent({ kind: 'liquidity', token: getTokenById(token.id), chain });
    }
  }

  const lastBlock = blocks.length ? blocks[blocks.length - 1] : null;
  if (lastBlock) {
    const bn = unhex(lastBlock.number);
    setCursor(chain.id, 'blocks', bn, { hash: lastBlock.hash });
    setChainState(chain.id, { last_block: bn, last_scan_at: now(), last_block_hash: lastBlock.hash, status: 'live' });
  }
  if (newTokens) logLine(chain.id, 'info', `discovered ${newTokens} token(s)`, { from, to });
  await refreshEvmPools(chain);
  return { from, to, newTokens, head };
}

// Compute live price / liquidity for tracked pools straight from on-chain reserves.
export async function refreshEvmPools(chain) {
  const client = getClient(chain);
  if (!client) return 0;
  const pools = db
    .prepare(
      `SELECT id, pool, quote_token, decimals, address, dex, baseline_price, price, stage FROM tokens
       WHERE chain = ? AND pool IS NOT NULL ORDER BY updated_at DESC LIMIT 40`,
    )
    .all(chain.id);
  if (!pools.length) return 0;
  const v3 = pools.filter((p) => /v3|V3/i.test(p.dex || ''));
  const v2 = pools.filter((p) => !/v3|V3/i.test(p.dex || ''));

  const calls = [];
  for (const p of v2) {
    calls.push({ key: p.id, kind: 'v2', method: 'eth_call', params: [{ to: p.pool, data: SEL.getReserves }, 'latest'] });
  }
  for (const p of v3) {
    calls.push({ key: p.id, kind: 'v3', method: 'eth_call', params: [{ to: p.pool, data: SEL.token0 }, 'latest'] });
  }
  const results = await client.batch(calls.map(({ method, params }) => ({ method, params })));
  let updated = 0;
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const r = results[i]?.result;
    if (!r) continue;
    const tok = pools.find((p) => p.id === c.key);
    if (!tok) continue;
    if (c.kind === 'v2') {
      const words = r.slice(2).match(/.{64}/g) || [];
      const r0 = BigInt('0x' + words[0]);
      const r1 = BigInt('0x' + (words[1] || '0'));
      const quoteIsToken0 = (tok.quote_token || '').toLowerCase() === tok.address.toLowerCase();
      const reserveQuote = quoteIsToken0 ? r0 : r1;
      const reserveToken = quoteIsToken0 ? r1 : r0;
      const quoteNativePrice = quoteUsd(chain, tok.quote_token);
      const dec = tok.decimals ?? 18;
      const quoteDec = chain.stableTokens?.some((s) => s.toLowerCase() === (tok.quote_token || '').toLowerCase()) ? 6 : 18;
      const { priceUsd, liquidityUsd } = priceFromReserves({
        reserveToken, reserveQuote, decimalsToken: dec, decimalsQuote: quoteDec, usdPerQuote: quoteNativePrice ?? 1,
      });
      if (priceUsd == null) continue;
      const supply = db.prepare('SELECT total_supply FROM tokens WHERE id = ?').get(tok.id)?.total_supply;
      applyQuote(chain, tok, { priceUsd, liquidityUsd, source: 'evm-reserves' });
      updated += 1;
    }
  }
  return updated;
}

export function applyQuote(chain, tok, { priceUsd, liquidityUsd, source }) {
  const token = getTokenById(tok.id);
  if (!token) return;
  const ts = Date.now();
  const supplyNum = token.total_supply ? Number(token.total_supply) / 10 ** (token.decimals ?? 18) : null;
  const marketCap = supplyNum && priceUsd ? supplyNum * priceUsd : null;
  const baselinePrice = token.baseline_price ?? null;
  if (!baselinePrice && priceUsd) {
    db.prepare(
      `UPDATE tokens SET baseline_price = ?, baseline_source = ?, baseline_at = ?, first_liquidity_price = ?,
        first_observed_price = COALESCE(first_observed_price, ?) WHERE id = ?`,
    ).run(priceUsd, source === 'evm-reserves' ? 'first-liquidity' : source, ts, priceUsd, priceUsd, token.id);
  }
  const ath = token.ath_price == null || priceUsd > token.ath_price ? priceUsd : token.ath_price;
  const low = token.low_price == null || priceUsd < token.low_price ? priceUsd : token.low_price;
  db.prepare(
    `UPDATE tokens SET price = ?, price_source = ?, market_cap = ?, liquidity_usd = COALESCE(?, liquidity_usd),
      updated_at = ?, ath_price = ?, ath_at = CASE WHEN ? = 1 THEN ? ELSE ath_at END,
      low_price = ?, low_at = CASE WHEN ? = 1 THEN ? ELSE low_at END,
      last_price_at = ?, first_observed_price = COALESCE(first_observed_price, ?) WHERE id = ?`,
  ).run(
    priceUsd, source, marketCap, liquidityUsd, ts, ath, priceUsd === ath ? 1 : 0, ts, low, priceUsd === low ? 1 : 0, ts, ts, priceUsd, token.id,
  );
  snapshotPrice(token.id, { price: priceUsd, marketCap, liquidityUsd, source, ts });
  pruneSnapshots(token.id, 600);
  if (priceUsd > 0) onTokensUpdated({ token: getTokenById(token.id), chain });
}
