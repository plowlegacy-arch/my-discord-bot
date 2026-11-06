const GUILD_KEY = 'ts.guild';

export function getGuildId() {
  try {
    return localStorage.getItem(GUILD_KEY) || new URLSearchParams(location.search).get('guild') || '';
  } catch {
    return '';
  }
}

export function setGuildId(id) {
  try {
    if (id) localStorage.setItem(GUILD_KEY, id);
    else localStorage.removeItem(GUILD_KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { ok: false, error: text.slice(0, 200) };
  }
  if (!res.ok || (body && body.ok === false)) {
    throw new Error((body && body.error) || `request failed (${res.status})`);
  }
  return body;
}

export function guildQuery(extra = {}) {
  const params = new URLSearchParams();
  const guild = getGuildId();
  if (guild) params.set('guild', guild);
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const endpoints = {
  health: () => api('/api/health'),
  stats: () => api('/api/stats'),
  chains: () => api('/api/chains'),
  logs: (chain) => api(`/api/logs${guildQuery({ chain, limit: 80 })}`),
  scanChain: (id) => api(`/api/chains/${id}/scan`, { method: 'POST' }),
  tokens: (params) => api(`/api/tokens${guildQuery(params)}`),
  token: (id) => api(`/api/tokens/${id}`),
  events: (params) => api(`/api/events${guildQuery(params)}`),
  multipliers: () => api('/api/multipliers'),
  pnlOverview: () => api('/api/pnl/overview'),
  wallet: (chain, address) => api(`/api/pnl/wallet/${chain}/${address}`),
  security: () => api('/api/security'),
  economy: () => api(`/api/economy/overview${guildQuery()}`),
  config: () => api(`/api/economy/config${guildQuery()}`),
  saveConfig: (patch) => api(`/api/economy/config${guildQuery()}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  leaderboard: (by) => api(`/api/economy/leaderboard${guildQuery({ by })}`),
  members: () => api(`/api/economy/members${guildQuery()}`),
  member: (id) => api(`/api/economy/member/${id}${guildQuery()}`),
  transactions: () => api(`/api/economy/transactions${guildQuery()}`),
  audit: () => api(`/api/economy/audit${guildQuery()}`),
  casino: () => api(`/api/casino/stats${guildQuery()}`),
  businesses: () => api(`/api/businesses${guildQuery()}`),
  marketplace: (status) => api(`/api/marketplace${guildQuery({ status })}`),
  giveaways: () => api(`/api/giveaways${guildQuery()}`),
};
