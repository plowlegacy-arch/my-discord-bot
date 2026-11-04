import { db, now } from '../db.js';
import { getTokenById } from './tokens.js';

// Heuristic, explainable risk scoring. Every signal is recorded with a human
// explanation; no single signal can label a token "safe".

const risk = (level, weight, label, detail) => ({ level, weight, label, detail });

const CONC_BANDS = [
  [0.9, 30, 'Extreme concentration'],
  [0.7, 22, 'Very high concentration'],
  [0.5, 15, 'High concentration'],
  [0.3, 8, 'Elevated concentration'],
];

export function scoreSignals(signals) {
  let score = 0;
  const findings = [];
  for (const s of signals) {
    if (!s) continue;
    score += s.weight;
    findings.push(s);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 70 ? 'critical' : score >= 45 ? 'high' : score >= 22 ? 'medium' : 'low';
  return { score, level, findings };
}

export function analyzeToken(tokenId, evidence = {}) {
  const token = getTokenById(tokenId);
  if (!token) return null;
  const signals = [];
  const meta = evidence.metadata || (token.metadata ? safe(token.metadata) : {});
  const holders = evidence.holders || [];
  const supply = token.total_supply ? Number(token.total_supply) / 10 ** (token.decimals ?? 18) : null;

  if (meta.mintAuthority) {
    signals.push(risk('high', 25, 'Mint authority active', 'Mint authority can inflate supply at will.'));
  } else if (meta.mintAuthority === false) {
    signals.push(risk('info', 0, 'Mint authority revoked', 'Supply is fixed; no further minting possible.'));
  }
  if (meta.freezeAuthority) {
    signals.push(risk('high', 22, 'Freeze authority active', 'Creator can freeze holder accounts, blocking transfers.'));
  }
  if (meta.owner) {
    signals.push(risk('medium', 10, 'Ownership not renounced', `Owner ${short(meta.owner)} retains admin functions.`));
  }
  if (meta.upgradeable || meta.implementation) {
    signals.push(risk('high', 18, 'Upgradeable proxy', 'Contract logic can be replaced by the proxy admin.'));
  }
  if (meta.paused) {
    signals.push(risk('critical', 30, 'Transfers paused', 'Contract reports paused state — trading can be blocked.'));
  }
  if (meta.honeypot) {
    signals.push(risk('critical', 40, 'Honeypot indicators', 'Simulated sells revert or are taxed to zero.'));
  }
  if (meta.verified === false) {
    signals.push(risk('low', 4, 'Source not verified', 'No verified source published on the explorer.'));
  }
  if (meta.liquidityLocked === false) {
    signals.push(risk('medium', 12, 'Liquidity unlocked', 'LP tokens are not locked or burned; rug-pull possible.'));
  } else if (meta.liquidityLocked === true) {
    signals.push(risk('info', 0, 'Liquidity locked/burned', 'LP ownership is locked or sent to a burn address.'));
  }

  if (holders.length) {
    const top = holders.slice(0, 10).reduce((a, h) => a + h.pct, 0);
    const band = CONC_BANDS.find(([threshold]) => top >= threshold);
    if (band) {
      signals.push(risk(band[0] >= 0.7 ? 'high' : 'medium', band[1], band[2], `Top 10 wallets hold ${(top * 100).toFixed(1)}% of supply.`));
    }
    const creatorHolding = holders.find((h) => h.owner === token.creator);
    if (creatorHolding && creatorHolding.pct > 0.1) {
      signals.push(risk('high', 18, 'Creator holds large supply', `Creator holds ${(creatorHolding.pct * 100).toFixed(1)}% of supply.`));
    }
    const sniperCluster = holders.filter((h) => h.firstBlock && token.deploy_block && h.firstBlock - token.deploy_block <= 1);
    if (sniperCluster.length >= 3) {
      signals.push(risk('medium', 12, 'Sniper wallets', `${sniperCluster.length} wallets bought within the first block.`));
    }
  }

  // Creator history across all launches we have observed on this chain.
  const history = token.creator
    ? db.prepare('SELECT COUNT(*) c FROM tokens WHERE chain = ? AND creator = ?').get(token.chain, token.creator).c
    : 0;
  if (history >= 4) {
    signals.push(risk('medium', 9, 'Serial deployer', `Creator has ${history} token deployments recorded by the scanner.`));
  }
  const priorRisky = token.creator
    ? db
        .prepare(
          `SELECT COUNT(*) c FROM tokens WHERE chain = ? AND creator = ? AND id != ? AND risk_level IN ('high','critical')`,
        )
        .get(token.chain, token.creator, token.id).c
    : 0;
  if (priorRisky > 0) {
    signals.push(risk('high', 16, 'Creator prior risk', `${priorRisky} earlier token(s) by this creator scored high/critical.`));
  }
  if (supply != null && supply <= 0) {
    signals.push(risk('high', 20, 'Zero supply', 'Total supply is zero — token cannot be traded normally.'));
  }
  if (!token.liquidity_usd) {
    signals.push(risk('low', 6, 'No liquidity detected', 'No on-chain pool found yet; price is unavailable.'));
  }
  if (!token.pool) {
    signals.push(risk('low', 3, 'No DEX market', 'No DEX market has been indexed for this token.'));
  }

  const { score, level, findings } = scoreSignals(signals);
  const report = {
    score,
    level,
    findings,
    checked_at: now(),
    method: 'on-chain heuristics (authorities, proxy, holders, creator history, liquidity state)',
    disclaimer: 'Risk scoring is heuristic and cannot prove a token is safe.',
  };
  db.prepare(
    `UPDATE tokens SET risk_score = ?, risk_level = ?, risk_report = ?, security_checked_at = ?, updated_at = ? WHERE id = ?`,
  ).run(score, level, JSON.stringify(report), now(), now(), token.id);
  return report;
}

export function analyzeAllPending(limit = 25) {
  const rows = db
    .prepare('SELECT id FROM tokens WHERE security_checked_at IS NULL OR security_checked_at < ? ORDER BY first_seen_at DESC LIMIT ?')
    .all(now() - 6 * 3600 * 1000, limit);
  for (const r of rows) analyzeToken(r.id);
  return rows.length;
}

export function riskSummary() {
  return db.prepare(`SELECT COALESCE(risk_level,'unchecked') level, COUNT(*) c FROM tokens GROUP BY level`).all();
}

function safe(v) {
  try { return JSON.parse(v); } catch { return {}; }
}
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
