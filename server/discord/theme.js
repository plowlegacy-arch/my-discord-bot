import { EmbedBuilder } from 'discord.js';

// TRENCH SCANNER — shared visual identity for every embed the bot sends.
// One typographic system, per-domain accents, no generic bot chrome.

export const COLORS = {
  brand: 0x14e0a0,
  economy: 0x2dd4bf,
  casino: 0xf43f5e,
  mining: 0xfbbf24,
  jobs: 0x38bdf8,
  business: 0xa3e635,
  discovery: 0x14f195,
  security: 0xf59e0b,
  multiplier: 0x22d3ee,
  pnl: 0x34d399,
  wallet: 0x818cf8,
  giveaway: 0xf472b6,
  danger: 0xef4444,
  muted: 0x64748b,
};

export const DIVIDER = '━━━━━━━━━━━━━━━━━━━━';
export const BRAND = 'TRENCH SCANNER';

export const ICON = {
  wave: '🌊',
  wallet: '👛',
  bank: '🏦',
  coin: '🪙',
  chart: '📊',
  shield: '🛡',
  fire: '🔥',
  clock: '⏱',
  check: '✅',
  cross: '❌',
  warn: '⚠️',
  gift: '🎁',
  pick: '⛏',
  fish: '🎣',
  hunt: '🏹',
  key: '🗝',
  compass: '🧭',
};

const nf = new Intl.NumberFormat('en-US');

export const num = (v, fallback = '0') => (v == null || Number.isNaN(Number(v)) ? fallback : nf.format(Math.round(Number(v))));

export function money(v, symbol = '⛏') {
  const n = Number(v);
  if (!Number.isFinite(n)) return `${symbol} 0`;
  const sign = n < 0 ? '-' : '';
  return `${sign}${symbol} ${num(Math.abs(n))}`;
}

export function usd(v, digits = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NOT AVAILABLE';
  if (n === 0) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n < 0.01) return `$${n.toPrecision(3)}`;
  return `$${n.toFixed(digits)}`;
}

/** Unlimited multiplier formatting — never caps, keeps precision at scale. */
export function mult(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1000) return `${Math.round(n).toLocaleString('en-US')}x`;
  if (n >= 100) return `${n.toFixed(0)}x`;
  if (n >= 10) return `${n.toFixed(2)}x`;
  return `${n.toFixed(2)}x`;
}

export const pct = (v, digits = 1) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
};

export function progress(value, max, size = 12) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const filled = Math.round(ratio * size);
  return `${'▰'.repeat(filled)}${'▱'.repeat(Math.max(0, size - filled))} ${Math.round(ratio * 100)}%`;
}

export function timeAgo(ts) {
  if (!ts) return 'unknown';
  const s = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function duration(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const short = (addr, head = 6, tail = 4) =>
  addr ? `${String(addr).slice(0, head)}…${String(addr).slice(-tail)}` : 'UNKNOWN';

export const inlineCode = (v) => `\`${v ?? '—'}\``;

/**
 * Base premium embed. `style` picks the accent + footer identity and
 * `sections` renders as spaced field blocks, never a wall of text.
 */
export function embed(style = 'brand', { title, subtitle, description, fields = [], footer, thumbnail, image, timestamp = true, url } = {}) {
  const color = typeof style === 'number' ? style : COLORS[style] ?? COLORS.brand;
  const e = new EmbedBuilder().setColor(color);
  const heading = title ? `${title}` : null;
  e.setAuthor({ name: `${BRAND}${subtitle ? `  •  ${subtitle}` : ''}` });
  if (heading) e.setTitle(heading);
  if (description) e.setDescription(description);
  if (fields.length) e.addFields(fields.filter(Boolean));
  e.setFooter({ text: footer ? `${BRAND} — ${footer}` : `${BRAND} — premium community economy` });
  if (thumbnail) e.setThumbnail(thumbnail);
  if (image) e.setImage(image);
  if (url) e.setURL(url);
  if (timestamp) e.setTimestamp(new Date());
  return e;
}

export const ok = (style, title, description, extra = {}) =>
  embed(style, { title: `${ICON.check}  ${title}`, description, ...extra });

export const fail = (title, description) =>
  embed('danger', { title: `${ICON.cross}  ${title}`, description });

export function section(title, lines) {
  return { name: title, value: lines.filter(Boolean).join('\n') || '—', inline: true };
}

export const block = (title, lines) => ({ name: title, value: lines.filter(Boolean).join('\n') || '—', inline: false });

export function kv(label, value) {
  return `${label}: **${value}**`;
}

export const blank = { name: '\u200b', value: '\u200b', inline: true };

/** Consistent result envelope for embeds + components + optional files. */
export const reply = (embedOrList, components = [], extra = {}) => {
  const embeds = Array.isArray(embedOrList) ? embedOrList : [embedOrList];
  const payload = { embeds, ...extra };
  if (components.length) payload.components = components;
  return payload;
};

export function errorText(reason, map = {}) {
  const table = {
    insufficient_cash: 'You do not have enough cash in your wallet for that.',
    insufficient_bank: 'Your bank does not hold that much.',
    bank_full: 'Your bank is at capacity. Upgrade it or spend some cash.',
    below_min_bet: 'That wager is below the server minimum bet.',
    above_max_bet: 'That wager is above the server maximum bet.',
    wager_must_be_positive: 'Wagers must be a positive whole number.',
    not_open: 'That listing is no longer open.',
    own_listing: 'You cannot buy your own listing.',
    insufficient_items: 'You do not have that many of the item.',
    ...map,
  };
  return table[reason] || `That action could not be completed (${reason || 'unknown'}).`;
}
