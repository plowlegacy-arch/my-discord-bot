import React, { useEffect, useState } from 'react';
import { endpoints } from '../api.js';
import { useFetch, Card, Pill, Stat, Status, usd, price, num, ago, chainLabel, short, mult, Segmented, RiskBadge, Sparkline, datetime } from '../ui.jsx';

const FEEDS = [
  { value: 'all', label: 'All tokens' },
  { value: 'deployments', label: 'Deployments' },
  { value: 'launches', label: 'Launches' },
  { value: 'liquidity', label: 'New liquidity' },
  { value: 'tradable', label: 'Newly tradable' },
  { value: 'trending', label: 'Trending' },
  { value: 'migrated', label: 'Migrated' },
];

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'marketcap', label: 'Market cap' },
  { value: 'liquidity', label: 'Liquidity' },
  { value: 'volume', label: 'Volume' },
  { value: 'gainers', label: 'Gainers' },
];

function Detail({ id, onClose }) {
  const { data, error, loading } = useFetch(() => endpoints.token(id), [id]);
  const t = data?.token || {};
  const sec = t.security || t.risk_report || null;
  const flags = Array.isArray(sec) ? sec : sec?.flags || [];

  return (
    <div className="card" style={{ position: 'sticky', top: 78 }}>
      <div className="card-head">
        <div>
          <h2>{t.symbol ? `$${t.symbol}` : 'Token detail'}</h2>
          <div className="card-sub">{t.name || chainLabel(t.chain)}</div>
        </div>
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={onClose}>Close</button>
      </div>

      <Status loading={loading && !data} error={error}>
        <div className="grid k2" style={{ gap: 10, marginBottom: 14 }}>
          <div className="stat"><span className="stat-label">Price</span><span className="stat-value sm mono">{price(t.price)}</span></div>
          <div className="stat"><span className="stat-label">Market cap</span><span className="stat-value sm mono">{usd(t.market_cap)}</span></div>
          <div className="stat"><span className="stat-label">Liquidity</span><span className="stat-value sm mono">{usd(t.liquidity_usd)}</span></div>
          <div className="stat"><span className="stat-label">Multiplier</span><span className="stat-value sm mono pos">{mult(t.multiplier ?? (t.baseline_price > 0 && t.price > 0 ? t.price / t.baseline_price : null))}</span></div>
        </div>

        <dl className="kv">
          <dt>Chain</dt><dd>{chainLabel(t.chain)}</dd>
          <dt>Stage</dt><dd>{t.stage || '—'}</dd>
          <dt>Address</dt><dd>{t.address || '—'}</dd>
          <dt>Creator</dt><dd>{t.creator || '—'}</dd>
          <dt>Deploy tx</dt><dd>{t.deploy_tx || '—'}</dd>
          <dt>First seen</dt><dd>{datetime(t.first_seen_at)}</dd>
          <dt>Supply</dt><dd>{t.total_supply ? num(t.total_supply) : t.supply ? num(t.supply) : '—'}</dd>
          <dt>Holders</dt><dd>{t.holders ? num(t.holders) : '—'}</dd>
          <dt>Baseline</dt><dd>{price(t.baseline_price)} {t.baseline_source ? `(${t.baseline_source})` : ''}</dd>
          <dt>Launchpad</dt><dd>{t.launchpad || '—'}</dd>
          <dt>DEX / pool</dt><dd>{t.dex || '—'}{t.pool ? ` · ${short(t.pool)}` : ''}</dd>
        </dl>

        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <RiskBadge level={t.risk_level} score={t.risk_score} />
          {t.explorer && <a className="btn" href={t.explorer} target="_blank" rel="noreferrer">Explorer</a>}
          {t.explorer_tx && <a className="btn ghost" href={t.explorer_tx} target="_blank" rel="noreferrer">Transaction</a>}
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="stat-label" style={{ marginBottom: 8 }}>Security findings</div>
          {flags.length === 0 && <div className="small dim">No findings recorded yet — analysis runs after liquidity is observed.</div>}
          {flags.slice(0, 8).map((f, i) => (
            <div className="alert-line" key={i}>
              <span className="icon">{f.severity === 'high' || f.severity === 'critical' ? '⛔' : f.severity === 'medium' ? '⚠' : 'ℹ'}</span>
              <div>
                <div style={{ fontWeight: 600 }}>{f.title || f.label || f.code}</div>
                <div className="small dim">{f.detail || f.description || f.message}</div>
              </div>
            </div>
          ))}
        </div>

        {Array.isArray(t.events) && t.events.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="stat-label" style={{ marginBottom: 8 }}>Event timeline</div>
            {t.events.slice(0, 10).map((e, i) => (
              <div className="scan-line" key={i}>
                <time>{datetime(e.ts)}</time>
                <span>{e.type}</span>
                <span className="dim truncate" style={{ flex: 1 }}>{short(e.tx_hash || e.tx, 8, 6)}</span>
              </div>
            ))}
          </div>
        )}
      </Status>
    </div>
  );
}

export default function Tokens({ chains, params }) {
  const initialFeed = params?.get?.('feed') || 'all';
  const [feed, setFeed] = useState(initialFeed);
  const [chain, setChain] = useState('');
  const [sort, setSort] = useState('newest');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, error, loading } = useFetch(
    () => endpoints.tokens({ feed: feed === 'all' ? undefined : feed, chain: chain || undefined, sort, search: query || undefined, limit: 100 }),
    [feed, chain, sort, query],
    { poll: 20000 },
  );

  const rows = data?.tokens || [];
  const total = data?.total || 0;

  return (
    <>
      <div className="grid k4">
        <Stat label="Matching tokens" value={num(total)} meta={`${rows.length} shown`} small />
        <Stat label="With liquidity" value={num(rows.filter((r) => Number(r.liquidity_usd) > 0).length)} meta="of current page" small />
        <Stat label="Trading stage" value={num(rows.filter((r) => r.stage === 'trading' || r.stage === 'migrated').length)} meta="of current page" small />
        <Stat label="Priced" value={num(rows.filter((r) => Number(r.price) > 0).length)} meta="baseline-anchored" small />
      </div>

      <Card flush>
        <div style={{ padding: '14px 16px 10px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented options={FEEDS} value={feed} onChange={setFeed} />
          <span style={{ flex: 1 }} />
          <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label="Chain filter">
            <option value="">All chains</option>
            {chains.map((c) => <option key={c.id} value={c.id}>{chainLabel(c.id)}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <input
            type="search"
            placeholder="Search symbol, name or address"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240 }}
          />
        </div>

        <Status loading={loading && !data} error={error}>
          <div className="table-wrap" style={{ maxHeight: 640 }}>
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Chain</th>
                  <th>Stage</th>
                  <th className="right">Price</th>
                  <th className="right">Market cap</th>
                  <th className="right">Liquidity</th>
                  <th className="right">Volume</th>
                  <th className="right">Mult</th>
                  <th>Risk</th>
                  <th className="right">First seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} onClick={() => setSelected(t.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="token-cell">
                        <div className="token-badge">{(t.symbol || '?').slice(0, 3).toUpperCase()}</div>
                        <div style={{ minWidth: 0 }}>
                          <div className="token-name truncate">{t.symbol ? `$${t.symbol}` : 'unnamed'}</div>
                          <div className="token-sym">{short(t.address, 8, 5)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="small">{chainLabel(t.chain)}</td>
                    <td><Pill tone={t.stage === 'trading' ? 'green' : t.stage === 'migrated' ? 'blue' : t.stage === 'liquidity' ? 'amber' : 'muted'}>{t.stage || 'deployed'}</Pill></td>
                    <td className="right mono small">{price(t.price)}</td>
                    <td className="right mono small">{usd(t.market_cap)}</td>
                    <td className="right mono small">{usd(t.liquidity_usd)}</td>
                    <td className="right mono small">{usd(t.volume_usd)}</td>
                    <td className="right mono small pos">{mult(t.multiplier)}</td>
                    <td><RiskBadge level={t.risk_level} score={t.risk_score} /></td>
                    <td className="right small dim nowrap">{ago(t.first_seen_at)}</td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={10}>
                      <div className="empty">
                        No tokens match this feed yet. The scanner records deployments directly from chain RPC — configure an RPC endpoint to begin indexing.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Status>
      </Card>

      {selected && <Detail id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
