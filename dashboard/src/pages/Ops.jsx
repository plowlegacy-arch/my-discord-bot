import React, { useEffect, useState } from 'react';
import { endpoints, getGuildId, setGuildId } from '../api.js';
import { useFetch, Card, Stat, Pill, Status, Segmented, num, ago, datetime, chainLabel, short, duration } from '../ui.jsx';

/* -------------------------------------------------------------- giveaways */

const parseEntries = (g) => {
  const raw = g.entries;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
};

const parseWinners = (g) => {
  const raw = g.winner_ids;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
};

export function Giveaways() {
  const [status, setStatus] = useState('all');
  const { data, error, loading } = useFetch(() => endpoints.giveaways(), [], { poll: 20000 });
  const all = data?.giveaways || [];
  const rows = status === 'all' ? all : all.filter((g) => (g.status || 'open') === status);
  const open = all.filter((g) => g.status === 'open');
  const totalEntries = all.reduce((a, g) => a + parseEntries(g).length, 0);

  return (
    <>
      <div className="grid k4">
        <Stat label="Giveaways" value={num(all.length)} meta="all time" small />
        <Stat label="Open now" value={num(open.length)} meta="accepting entries" small />
        <Stat label="Entries" value={num(totalEntries)} meta="across every giveaway" small />
        <Stat label="Ended" value={num(all.filter((g) => g.status === 'ended').length)} meta="winners drawn" small />
      </div>

      <Card
        title="Giveaway history"
        sub="Currency, items and custom prizes with automatic winner selection"
        actions={<Segmented options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'ended', label: 'Ended' }]} value={status} onChange={setStatus} />}
        flush
      >
        <Status loading={loading && !data} error={error}>
          <div className="table-wrap" style={{ maxHeight: 620 }}>
            <table>
              <thead>
                <tr><th>Prize</th><th>Kind</th><th className="right">Winners</th><th className="right">Entries</th><th>Status</th><th>Ends</th><th>Winners drawn</th></tr>
              </thead>
              <tbody>
                {rows.map((g) => {
                  const winners = parseWinners(g);
                  return (
                    <tr key={g.id}>
                      <td>
                        <div className="token-name truncate" style={{ maxWidth: 260 }}>{g.prize}</div>
                        <div className="token-sym">host {short(g.host_id, 6, 4)} · #{g.id}</div>
                      </td>
                      <td><Pill tone={g.prize_kind === 'item' ? 'amber' : 'green'}>{g.prize_kind || 'currency'}</Pill></td>
                      <td className="right mono small">{num(g.winners ?? 1)}</td>
                      <td className="right mono small">{num(parseEntries(g).length)}</td>
                      <td><Pill tone={g.status === 'open' ? 'green' : 'muted'}>{g.status || 'open'}</Pill></td>
                      <td className="small dim nowrap">{g.ends_at ? `${datetime(g.ends_at)} · ${g.status === 'open' ? ago(g.ends_at) : 'closed'}` : '—'}</td>
                      <td className="mono small dim">{winners.length ? winners.map((w) => short(w, 6, 4)).join(', ') : '—'}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && !loading && (
                  <tr><td colSpan={7}><div className="empty">No giveaways yet. Start one with <code>/giveaway</code> in Discord.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Status>
      </Card>
    </>
  );
}

/* --------------------------------------------------------------- settings */

const THEMES = {
  solana: { label: 'Solana green', accent: '#14f195', accent2: '#00d18c' },
  emerald: { label: 'Emerald', accent: '#34d399', accent2: '#10b981' },
  cyan: { label: 'Cyan', accent: '#22d3ee', accent2: '#06b6d4' },
  amber: { label: 'Amber', accent: '#fbbf24', accent2: '#f59e0b' },
};

const THEME_KEY = 'ts.theme';

export function applyTheme(name) {
  const t = THEMES[name] || THEMES.solana;
  const root = document.documentElement;
  root.style.setProperty('--green', t.accent);
  root.style.setProperty('--green-dim', t.accent2);
  root.dataset.theme = name;
}

try {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme) applyTheme(savedTheme);
} catch {
  /* storage unavailable */
}

export function Settings({ onGuildSaved }) {
  const [guild, setGuild] = useState(getGuildId());
  const [saved, setSaved] = useState('');
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) || 'solana';
    } catch {
      return 'solana';
    }
  });
  const health = useFetch(() => endpoints.health(), [], { poll: 15000 });
  const config = useFetch(() => endpoints.config(), [saved]);

  const submit = (e) => {
    e.preventDefault();
    setGuildId(guild.trim());
    setSaved(guild.trim());
    if (onGuildSaved) onGuildSaved(guild.trim());
  };

  const chooseTheme = (name) => {
    setTheme(name);
    applyTheme(name);
    try {
      localStorage.setItem(THEME_KEY, name);
    } catch {
      /* ignore */
    }
  };

  const h = health.data || {};
  const cfg = config.data?.config || {};

  return (
    <div className="grid split">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Card title="Server selection" sub="The dashboard is scoped to one Discord server at a time">
          <form onSubmit={submit} className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <input value={guild} onChange={(e) => setGuild(e.target.value)} placeholder="Discord server (guild) ID" style={{ flex: 1, minWidth: 260 }} />
            <button type="submit" className="btn primary">Apply</button>
          </form>
          <div className="small dim" style={{ marginTop: 10 }}>
            Every server keeps an independent economy: wallets, banks, inventory, careers, businesses, casino history and audit log.
          </div>
          {saved && <div className="ok-box" style={{ marginTop: 10 }}>Dashboard now scoped to {saved || 'all servers'}.</div>}
        </Card>

        <Card title="Interface theme" sub="Accent palette across the dashboard">
          <div className="theme-grid">
            {Object.entries(THEMES).map(([key, t]) => (
              <button type="button" key={key} className={`theme-swatch ${theme === key ? 'active' : ''}`} onClick={() => chooseTheme(key)}>
                <span className="swatch-dot" style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent2})` }} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Runtime health" sub="API and bot process">
          <dl className="kv">
            <dt>API</dt><dd>{h.ok ? <Pill tone="green">online</Pill> : <Pill tone="red">offline</Pill>}</dd>
            <dt>Uptime</dt><dd>{h.uptime ? duration(h.uptime * 1000) : '—'}</dd>
            <dt>Discord bot</dt><dd>{h.bot?.ready ? <Pill tone="green">{h.bot.tag || 'connected'}</Pill> : <Pill tone="amber">not connected</Pill>}</dd>
            <dt>Database</dt><dd>{h.db || 'sqlite'}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Effective configuration" sub="Currency, rewards and limits for this server" flush>
        <Status loading={config.loading && !config.data} error={config.error}>
          <div className="table-wrap" style={{ maxHeight: 620 }}>
            <table>
              <tbody>
                {Object.entries(cfg)
                  .filter(([k]) => !['guild_id', 'created_at', 'updated_at', 'id'].includes(k))
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td className="small dim" style={{ textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</td>
                      <td className="mono small right">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                    </tr>
                  ))}
                {Object.keys(cfg).length === 0 && <tr><td><div className="empty">Select a server to load its configuration.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </Status>
        <div className="small dim" style={{ padding: '10px 16px' }}>
          Editable from the Economy page. Administrative actions are audited with actor, target, amount and timestamp.
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ audit */

export function Audit() {
  const { data, error, loading } = useFetch(() => endpoints.audit(), [], { poll: 20000 });
  const rows = data?.audit || [];

  return (
    <Card title="Audit log" sub="Administrative actions and currency minting" flush>
      <Status loading={loading && !data} error={error}>
        <div className="table-wrap" style={{ maxHeight: 640 }}>
          <table>
            <thead>
              <tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th className="right">Amount</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="small dim nowrap">{datetime(r.ts || r.created_at)}</td>
                  <td className="mono small">{short(r.actor_id, 6, 4)}</td>
                  <td><Pill tone={String(r.action || '').includes('remove') ? 'red' : 'muted'}>{(r.action || r.kind || 'action').replace(/_/g, ' ')}</Pill></td>
                  <td className="mono small dim">{r.target_id ? short(r.target_id, 6, 4) : '—'}</td>
                  <td className={`right mono small ${Number(r.amount) >= 0 ? 'pos' : 'neg'}`}>{r.amount === null || r.amount === undefined ? '—' : num(r.amount)}</td>
                  <td className="small dim truncate" style={{ maxWidth: 280 }}>{r.detail || r.meta || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && !loading && <tr><td colSpan={6}><div className="empty">No audited actions yet.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </Status>
    </Card>
  );
}

/* -------------------------------------------------------------- api status */

export function ApiStatus({ health, chains }) {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const list = chains?.data?.chains || [];
  const h = health?.data || {};

  const scan = async (id) => {
    setBusy(id);
    setNote('');
    try {
      const r = await endpoints.scanChain(id);
      setNote(`${chainLabel(id)} scan: ${r.scanned ?? 0} blocks scanned, ${r.discovered ?? 0} new tokens.`);
      await chains.reload?.();
    } catch (e) {
      setNote(`${chainLabel(id)} scan failed: ${e.message}`);
    } finally {
      setBusy('');
    }
  };

  const live = list.filter((c) => c.live).length;
  const configured = list.filter((c) => c.configured).length;

  return (
    <>
      <div className="grid k4">
        <Stat label="Networks" value={num(list.length)} meta={`${configured} configured`} small />
        <Stat label="Live pipelines" value={num(live)} meta="streaming blocks" small tone={live ? 'pos' : ''} />
        <Stat label="API uptime" value={h.uptime ? duration(h.uptime * 1000) : '—'} small meta={h.ok ? 'healthy' : 'unreachable'} />
        <Stat label="Bot" value={h.bot?.ready ? 'online' : 'offline'} small tone={h.bot?.ready ? 'pos' : 'neg'} meta={h.bot?.tag || 'awaiting token'} />
      </div>

      {note && <div className="ok-box" style={{ marginBottom: 14 }}>{note}</div>}

      <Card title="Chain status" sub="Each pipeline reports its own cursors and failures" flush>
        <Status loading={chains?.loading && !chains?.data} error={chains?.error}>
          <div className="table-wrap" style={{ maxHeight: 640 }}>
            <table>
              <thead>
                <tr><th>Network</th><th>Family</th><th>State</th><th className="right">Block</th><th className="right">Head</th><th className="right">Lag</th><th className="right">Failures</th><th>Last activity</th><th /></tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const lag = c.head_block && c.last_block ? Math.max(0, Number(c.head_block) - Number(c.last_block)) : null;
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="token-name">{c.name}</div>
                        <div className="token-sym">{c.rpc_env || c.note || '—'}</div>
                      </td>
                      <td className="small dim">{c.family}</td>
                      <td>
                        <Pill tone={c.live ? 'green' : c.configured ? 'amber' : 'muted'}>
                          {c.live ? 'live' : c.configured ? 'idle' : 'unconfigured'}
                        </Pill>
                      </td>
                      <td className="right mono small">{c.last_block === null || c.last_block === undefined ? '—' : num(c.last_block)}</td>
                      <td className="right mono small dim">{c.head_block === null || c.head_block === undefined ? '—' : num(c.head_block)}</td>
                      <td className="right mono small">{lag === null ? '—' : num(lag)}</td>
                      <td className={`right mono small ${Number(c.failures) > 0 ? 'neg' : 'dim'}`}>{num(c.failures)}</td>
                      <td className="small dim nowrap">{c.last ? ago(c.last) : 'never'}</td>
                      <td className="right">
                        <button type="button" className="btn ghost small" disabled={!c.configured || busy === c.id} onClick={() => scan(c.id)}>
                          {busy === c.id ? 'Scanning…' : 'Backfill'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {list.length === 0 && <tr><td colSpan={9}><div className="empty">Chain registry unavailable.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </Status>
      </Card>

      <Card title="Public API" sub="Read endpoints consumed by this dashboard">
        <div className="api-grid">
          {[
            ['GET', '/api/stats', 'Aggregate scanner and bot counters'],
            ['GET', '/api/chains', 'Chain pipelines, cursors and health'],
            ['GET', '/api/tokens', 'Filterable token feed with multipliers'],
            ['GET', '/api/tokens/:id', 'Full token dossier and risk report'],
            ['GET', '/api/events', 'Deployment, launch, liquidity and trade events'],
            ['GET', '/api/multipliers', 'Leaders and milestone crossings'],
            ['GET', '/api/pnl/overview', 'Wallet PNL leaderboard'],
            ['GET', '/api/pnl/wallet/:chain/:address', 'Wallet positions and swaps'],
            ['GET', '/api/security', 'Risk distribution and flagged tokens'],
            ['GET', '/api/economy/overview', 'Server economy aggregates'],
            ['GET', '/api/economy/member/:id', 'Member dossier'],
            ['GET', '/api/casino/stats', 'Casino handle and leaderboard'],
            ['GET', '/api/giveaways', 'Giveaway history'],
            ['GET', '/api/stream', 'Server-sent events for live updates'],
          ].map(([method, path, desc]) => (
            <div className="api-row" key={path}>
              <Pill tone="green">{method}</Pill>
              <code>{path}</code>
              <span className="small dim">{desc}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
