import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import {
  COLORS, DIVIDER, ICON, block, embed, mult, num, pct, section, short, timeAgo, usd, duration,
} from './theme.js';

// TRENCH SCANNER — intelligence embeds. Every alert type has its own layout so a
// deployment never looks like a multiplier and a security warning never looks
// like a discovery, while the typographic system stays identical.

const EVENT_LABEL = {
  deploy: 'TOKEN DEPLOYMENT',
  mint: 'TOKEN MINTED',
  launch: 'LAUNCHPAD LAUNCH',
  liquidity: 'FIRST LIQUIDITY',
  trade: 'FIRST TRADE',
  migrate: 'MIGRATION / GRADUATION',
  graduate: 'MIGRATION / GRADUATION',
};

const EVENT_STYLE = {
  deploy: 'discovery',
  mint: 'discovery',
  launch: 'discovery',
  liquidity: 'multiplier',
  trade: 'multiplier',
  migrate: 'business',
  graduate: 'business',
};

export const STAGE_LABEL = {
  deployed: 'DEPLOYED — no market yet',
  minted: 'MINTED — no market yet',
  launched: 'LAUNCHED — bonding curve',
  liquidity: 'LIQUID — pool created',
  trading: 'TRADING — active market',
  graduated: 'GRADUATED — migrated',
  dead: 'INACTIVE',
};

const chainTag = (chain) => String(chain || 'unknown').toUpperCase();

function priceLine(token) {
  if (token.price == null) return '📉 PRICE: NOT AVAILABLE YET';
  return `📉 PRICE: ${usd(token.price, 8)}`;
}

function mcLine(token) {
  return `📊 MARKET CAP: ${token.market_cap ? usd(token.market_cap) : 'NOT AVAILABLE'}`;
}

function liqLine(token) {
  return `💧 LIQUIDITY: ${token.liquidity_usd ? usd(token.liquidity_usd) : 'NOT DETECTED'}`;
}

function riskLine(token) {
  if (!token.risk_level) return `${ICON.shield} SECURITY: ANALYSIS PENDING`;
  const level = String(token.risk_level).toUpperCase();
  return `${ICON.shield} SECURITY: ${level}${token.risk_score != null ? ` (${token.risk_score}/100)` : ''}`;
}

/** Deployment / launch / liquidity / trade alert. */
export function tokenEventEmbed(token, eventType = 'deploy') {
  const style = EVENT_STYLE[eventType] || 'discovery';
  const label = EVENT_LABEL[eventType] || String(eventType).toUpperCase();
  const symbol = token.symbol ? `$${token.symbol}` : short(token.address, 6, 6);
  return embed(style, {
    title: `${ICON.fire}  ${label}  •  ${symbol}  |  ${chainTag(token.chain)}`,
    description: [
      DIVIDER,
      `🪙 **${token.name || 'UNNAMED TOKEN'}**  ${token.symbol ? `($${token.symbol})` : ''}`,
      '',
      `🆕 EVENT: **${label}**`,
      `👤 CREATOR: \`${token.creator || 'UNKNOWN'}\``,
      '',
      `⏱ CREATED: ${timeAgo(token.created_at || token.first_seen_at)}`,
      `📦 SUPPLY: ${token.initial_supply || token.total_supply ? num(token.initial_supply || token.total_supply) : 'UNKNOWN'}`,
      '',
      liqLine(token),
      mcLine(token),
      '',
      riskLine(token),
      DIVIDER,
    ].join('\n'),
    fields: [
      block('CONTRACT', [`\`${token.address}\``]),
      block('PIPELINE STAGE', [STAGE_LABEL[token.stage] || String(token.stage || 'deployed').toUpperCase()]),
    ],
    footer: `${chainTag(token.chain)} on-chain discovery`,
  });
}

/** Unlimited multiplier alert — never caps, so 100,000x renders fine. */
export function multiplierEmbed({ token, multiple, basis = 'price', price, marketCap }) {
  const baseline = basis === 'marketcap' ? token.baseline_market_cap : token.baseline_price;
  const current = basis === 'marketcap' ? (marketCap ?? token.market_cap) : (price ?? token.price);
  const change = Number.isFinite(multiple) ? (multiple - 1) * 100 : null;
  const ath = token.ath_multiple || (token.ath_price && token.baseline_price ? token.ath_price / token.baseline_price : null);
  const tracked = token.baseline_at ? duration(Date.now() - token.baseline_at) : 'unknown';
  return embed('multiplier', {
    title: `${ICON.fire}  MULTIPLIER ALERT  •  ${token.symbol ? `$${token.symbol}` : short(token.address)}  |  ${chainTag(token.chain)}`,
    description: [
      DIVIDER,
      `💰 INITIAL ${basis === 'marketcap' ? 'MC' : 'PRICE'}: ${basis === 'marketcap' ? usd(baseline) : usd(baseline, 8)}`,
      `📈 CURRENT ${basis === 'marketcap' ? 'MC' : 'PRICE'}: ${basis === 'marketcap' ? usd(current) : usd(current, 8)}`,
      '',
      `🔥 MULTIPLIER: **${mult(multiple)}**`,
      `💹 CHANGE: ${pct(change)}`,
      '',
      `🏆 ATH: ${mult(ath)}`,
      `📊 STATUS: ${token.price && token.baseline_price && token.price >= token.baseline_price ? 'RUNNING' : 'BELOW BASELINE'}`,
      '',
      `⏱ TRACKING: ${tracked}`,
      DIVIDER,
    ].join('\n'),
    fields: [
      section('BASIS', [basis.toUpperCase()]),
      section('LIQUIDITY', [token.liquidity_usd ? usd(token.liquidity_usd) : 'NOT DETECTED']),
      section('RISK', [token.risk_level ? String(token.risk_level).toUpperCase() : 'PENDING']),
    ],
    footer: 'unlimited multiplier engine',
  });
}

/** Security analysis — every signal is listed, never a single-signal verdict. */
export function securityEmbed(token, report) {
  const r = report || {};
  const signals = Array.isArray(r.signals) ? r.signals : [];
  const rows = signals.slice(0, 12).map((s) => {
    const mark = s.level === 'critical' || s.level === 'high' ? ICON.cross : s.level === 'medium' ? ICON.warn : ICON.check;
    return `${mark} **${s.label}** — ${s.detail || s.level}`;
  });
  return embed('security', {
    title: `${ICON.shield}  SECURITY ANALYSIS  •  ${token.symbol ? `$${token.symbol}` : short(token.address)}  |  ${chainTag(token.chain)}`,
    description: [
      DIVIDER,
      `RISK LEVEL: **${String(token.risk_level || r.level || 'pending').toUpperCase()}**`,
      `RISK SCORE: **${token.risk_score ?? r.score ?? '—'}/100**`,
      '',
      r.summary || 'Signals are collected from on-chain reads only.',
      DIVIDER,
    ].join('\n'),
    fields: signals.length
      ? [block('SIGNALS', rows)]
      : [block('SIGNALS', ['No contract-level signals collected yet.'])],
    footer: 'never safe from a single signal',
  });
}

/** Wallet PNL card built from real trades only. */
export function walletPnlEmbed(wallet) {
  const w = wallet || {};
  return embed('pnl', {
    title: `${ICON.chart}  WALLET PNL  •  ${short(w.address, 8, 6)}  |  ${chainTag(w.chain)}`,
    description: [
      DIVIDER,
      `REALIZED: ${usd(w.realized)}`,
      `UNREALIZED: ${usd(w.unrealized)}`,
      `TOTAL PNL: **${usd(w.total_pnl)}**`,
      '',
      `WIN RATE: ${w.win_rate != null ? `${Number(w.win_rate).toFixed(1)}%` : 'NO CLOSED TRADES'}`,
      `TRADES: ${num(w.trades)}  •  FEES: ${usd(w.fees)}`,
      DIVIDER,
    ].join('\n'),
    fields: [
      section('BEST TRADE', [w.best ? `${w.best.symbol || short(w.best.token, 6)}  ${usd(w.best.pnl)}` : '—']),
      section('WORST TRADE', [w.worst ? `${w.worst.symbol || short(w.worst.token, 6)}  ${usd(w.worst.pnl)}` : '—']),
      section('OPEN POSITIONS', [num((w.positions || []).length)]),
    ],
    footer: 'authentic on-chain fills only',
  });
}

/** Token detail card used by /token and the SCAN button. */
export function tokenDetailEmbed(token, extra = {}) {
  const events = (extra.events || []).slice(0, 5).map((e) => `• ${EVENT_LABEL[e.type] || e.type} — ${timeAgo(e.ts)}`);
  return embed('discovery', {
    title: `${token.symbol ? `$${token.symbol}` : short(token.address)}  •  ${token.name || 'UNNAMED'}  |  ${chainTag(token.chain)}`,
    description: [
      DIVIDER,
      `STAGE: **${STAGE_LABEL[token.stage] || token.stage}**`,
      `CREATOR: \`${token.creator || 'UNKNOWN'}\``,
      `DEPLOY TX: \`${token.deploy_tx || 'UNKNOWN'}\``,
      DIVIDER,
    ].join('\n'),
    fields: [
      section('MARKET', [priceLine(token), mcLine(token), liqLine(token)]),
      section('SUPPLY', [
        `📦 INITIAL: ${token.initial_supply ? num(token.initial_supply) : 'UNKNOWN'}`,
        `📦 TOTAL: ${token.total_supply ? num(token.total_supply) : 'UNKNOWN'}`,
        `👥 HOLDERS: ${token.holders != null ? num(token.holders) : 'UNKNOWN'}`,
      ]),
      section('MULTIPLIER', [
        `🔥 ${mult(extra.multiplier)}`,
        `🏆 ATH ${mult(extra.ath_multiple)}`,
        `⏱ ${timeAgo(token.baseline_at)} baseline`,
      ]),
      section('VENUE', [
        `🏦 DEX: ${token.dex || 'NOT DETECTED'}`,
        `🚀 LAUNCHPAD: ${token.launchpad || 'NONE'}`,
        `💧 POOL: ${token.pool ? short(token.pool, 8, 6) : 'NONE'}`,
      ]),
      section('RISK', [riskLine(token), `✅ VERIFIED: ${token.verified ? 'YES' : 'NO'}`]),
      section('ACTIVITY', [`🟢 BUYS: ${num(token.buys)}`, `🔴 SELLS: ${num(token.sells)}`]),
      block('RECENT EVENTS', events.length ? events : ['No events recorded yet.']),
    ],
    footer: 'token intelligence',
  });
}

/** Chain status board. */
export function chainStatusEmbed(rows) {
  const live = rows.filter((r) => r.live && r.configured);
  const planned = rows.filter((r) => !r.configured);
  const list = rows.map((r) => {
    const state = !r.configured ? '⚪ NOT CONFIGURED' : r.status === 'live' ? '🟢 LIVE' : '🟡 DEGRADED';
    return `**${chainTag(r.id)}** — ${state}  •  head ${r.head_block ? num(r.head_block) : '—'}`;
  });
  return embed('brand', {
    title: `${ICON.wave}  CHAIN STATUS`,
    description: [DIVIDER, `ACTIVE PIPELINES: **${live.length}**  •  PLANNED: **${planned.length}**`, DIVIDER].join('\n'),
    fields: [block('PIPELINES', list.slice(0, 20))],
    footer: 'direct RPC indexing',
  });
}

/** Buttons for a discovered token. */
export function tokenButtons(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`scan:${token.id}`).setLabel('SCAN').setEmoji('🔍').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`track:${token.id}`).setLabel('TRACK').setEmoji('📈').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel('TRANSACTION').setEmoji('🔗').setStyle(ButtonStyle.Link)
      .setURL(token.explorer_tx || `https://example.invalid/tx/${token.deploy_tx || ''}`),
  );
}

export function multiplierButtons(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`scan:${token.id}`).setLabel('TOKEN DETAILS').setEmoji('🪙').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`track:${token.id}`).setLabel('TRACK').setEmoji('📈').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pnl:${token.id}`).setLabel('PNL').setEmoji('💹').setStyle(ButtonStyle.Secondary),
  );
}

export const EMBED_COLORS = COLORS;
