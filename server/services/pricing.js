import { db } from '../db.js';

// Reference fiat prices for native/quote assets. These are SUPPLEMENTARY: they
// convert on-chain reserve values into USD. Token *discovery* never uses any
// external screener — only this conversion does.

const PRICE_TTL_MS = 10 * 60 * 1000;
const PRICE_ENDPOINT =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,binancecoin,matic-network,avalanche-2,solana,sonic-3,sei-network,hyperliquid&vs_currencies=usd';

const NATIVE_IDS = {
  ethereum: 'ethereum',
  bsc: 'binancecoin',
  base: 'ethereum',
  arbitrum: 'ethereum',
  optimism: 'ethereum',
  polygon: 'matic-network',
  avalanche: 'avalanche-2',
  sonic: 'sonic-3',
  seievm: 'sei-network',
  hyperevm: 'hyperliquid',
  solana: 'solana',
  monad: null,
  sui: 'sui',
};

let cache = { at: 0, data: {} };
const manual = new Map();

export function setNativeUsd(chainId, usd) {
  manual.set(chainId, { usd, at: Date.now() });
}

export async function refreshNativePrices() {
  if (Date.now() - cache.at < PRICE_TTL_MS) return cache.data;
  try {
    const res = await fetch(PRICE_ENDPOINT, {
      headers: { accept: 'application/json', 'user-agent': 'trench-scanner/1.0' },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`price feed http ${res.status}`);
    const json = await res.json();
    const data = {};
    for (const [chain, id] of Object.entries(NATIVE_IDS)) {
      if (id && json[id]?.usd) data[chain] = json[id].usd;
    }
    cache = { at: Date.now(), data };
    db.prepare(
      `INSERT INTO indexer_log (chain, level, message, meta, ts) VALUES ('global','info','native price refresh',?,?)`,
    ).run(JSON.stringify(data), Date.now());
    return data;
  } catch (err) {
    db.prepare(
      `INSERT INTO indexer_log (chain, level, message, meta, ts) VALUES ('global','warn','native price refresh failed',?,?)`,
    ).run(JSON.stringify({ error: err.message }), Date.now());
    cache = { at: Date.now() - PRICE_TTL_MS / 2, data: cache.data };
    return cache.data;
  }
}

export function nativeUsd(chainId) {
  const m = manual.get(chainId);
  if (m && Date.now() - m.at < PRICE_TTL_MS) return m.usd;
  return cache.data[chainId] ?? null;
}

export function totalUsd(chain, quoteToken) {
  const chainCfg = quoteToken ? null : null;
  return chainCfg;
}

// Convert a raw reserve amount into USD using the quote token.
export function quoteUsd(chain, quoteAddress, symbolHint) {
  if (!quoteAddress) return null;
  const lower = quoteAddress.toLowerCase();
  const stable = new Set((chain.stableTokens || []).map((a) => a.toLowerCase()));
  if (stable.has(lower) || /^(usdc|usdt|dai|usd\+|fdusd|busd)$/i.test(symbolHint || '')) return 1;
  if (chain.wrappedNative && lower === chain.wrappedNative.toLowerCase()) return nativeUsd(chain.id);
  return null;
}

// Constant-product price of token in quote units, from reserves.
export function priceFromReserves({ reserveToken, reserveQuote, decimalsToken, decimalsQuote, usdPerQuote }) {
  if (!reserveToken || !reserveQuote) return { priceQuote: null, priceUsd: null };
  const rt = Number(reserveToken) / 10 ** (decimalsToken ?? 18);
  const rq = Number(reserveQuote) / 10 ** (decimalsQuote ?? 18);
  if (!(rt > 0) || !(rq > 0)) return { priceQuote: null, priceUsd: null };
  const priceQuote = rq / rt;
  return {
    priceQuote,
    priceUsd: usdPerQuote != null ? priceQuote * usdPerQuote : null,
    liquidityUsd: usdPerQuote != null ? rq * 2 * usdPerQuote : null,
  };
}

export function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(n < 1 ? 6 : 2)}`;
}
