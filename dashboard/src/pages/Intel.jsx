import React, { useState } from 'react';
import { endpoints } from '../api.js';
import { useFetch, Card, Stat, Pill, Status, RiskBadge, Segmented, Sparkline, Progress, usd, price, mult, num, ago, chainLabel, short, duration, datetime } from '../ui.jsx';

const pick = (o, ...keys) => {
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
};

const levelOf = (m) => {
  const raw = pick(m, 'multiplier', 'level', 'milestone', 'target', 'value');
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------------------------------------ multipliers */

export function Multipliers() {
  const { data, error, loading } = useFetch(() => endpoints.multipliers(), [], { poll: 20000 });
  const leaders = data?.leaders || [];
  const milestones = data?.milestones || [];

  const buckets = [
    { label: '1.5x', min: 1.5, max: 2 },
    { label: '2x', min: 2, max: 5 },
    { label: '5x', min: 5, max: 10 },
    { label: '10x', min: 10, max: 50 },
    { label: '50x', min: 50, max: 100 },
    { label: '100x', min: 100, max: 1000 },
    { label: '1,000x+', min: 1000, max: Infinity },
  ];

  return (
    <>
      <div className="grid k4">
        <Stat label="Tracked runners" value={num(leaders.length)} meta="tokens with a recorded baseline" small />
        <Stat label="Best multiplier" value={mult(leaders.length ? levelOf(leaders[0]) : null)} meta={leaders[0] ? `$${leaders[0].symbol || '—'}` : 'awaiting data'} />
        <Stat label="Milestones hit" value={num(milestones.length)} meta="recent crossings" small />
        <Stat label="Ceiling" value="unlimited" small meta="no hard-coded maximum" />
      </div>

      <div className="grid split">
        <Card title="Multiplier leaders" sub="Measured against each token's first recorded observation" flush>
          <Status loading={loading && !data} error={error}>
            <div className="table-wrap" style={{ maxHeight: 520 }}>
              <table>
                <thead>
                  <tr><th>#</th><th>Token</th><th>Chain</th><th className="right">Baseline</th><th className="right">Price</th><th className="right">Market cap</th><th className="right">Mult</th><th className="right">Tracked</th></tr>
                </thead>
                <tbody>
                  {leaders.map((t, i) => (
                    <tr key={`${t.id}-${i}`}>
                      <td className="dim mono">{i + 1}</td>
                      <td>
                        <div className="token-cell">
                          <div className="token-badge">{(t.symbol || '?').slice(0, 3).toUpperCase()}</div>
                          <div style={{ minWidth: 0 }}>
                            <div className="token-name truncate">{t.symbol ? `$${t.symbol}` : short(t.address)}</div>
                            <div className="token-sym">{short(t.address, 6, 4)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="small">{chainLabel(t.chain)}</td>
                      <td className="right mono small dim">{price(pick(t, 'baseline_price', 'baseline'))}</td>
                      <td className="right mono small">{price(t.price)}</td>
                      <td className="right mono small">{usd(t.market_cap)}</td>
                      <td className="right mono pos">{mult(levelOf(t))}</td>
                      <td className="right small dim nowrap">{t.first_seen_at ? ago(t.first_seen_at) : '—'}</td>
                    </tr>
                  ))}
                  {leaders.length === 0 && !loading && (
                    <tr><td colSpan={8}><div className="empty">No multipliers yet — they appear once a token with a recorded baseline is observed again.</div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Status>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Milestone ladder" sub="Crossings detected by the tracker">
            <div className="ladder">
              {buckets.map((b) => {
                const count = leaders.filter((t) => {
                  const n = levelOf(t);
                  return n !== null && n >= b.min && n < b.max;
                }).length;
                return (
                  <div className="ladder-row" key={b.label}>
                    <span className="ladder-label">{b.label}</span>
                    <Progress value={count} max={Math.max(1, leaders.length)} />
                    <span className="ladder-count">{count}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Milestone feed" sub="Most recent crossings" flush>
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              {milestones.map((m, i) => (
                <div className="feed-row" key={`${m.id}-${i}`}>
                  <Pill tone="green">{mult(levelOf(m))}</Pill>
                  <span className="truncate" style={{ flex: 1 }}>{m.symbol ? `$${m.symbol}` : short(pick(m, 'address', 'token_address'))}</span>
                  <span className="small dim">{chainLabel(m.chain)}</span>
                  <span className="small dim nowrap">{pick(m, 'ts', 'created_at') ? ago(pick(m, 'ts', 'created_at')) : '—'}</span>
                </div>
              ))}
              {milestones.length === 0 && <div className="empty">No milestone crossings recorded yet.</div>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- pnl */

export function Pnl() {
  const { data, error, loading } = useFetch(() => endpoints.pnlOverview(), [], { poll: 30000 });
  const overview = data?.overview || {};
  const board = data?.leaderboard || [];

  return (
    <>
      <div className="grid k4">
        <Stat label="Wallets tracked" value={num(overview.tracked_wallets)} meta="from observed swaps" small />
        <Stat label="Wallets with trades" value={num(overview.wallets_with_trades)} meta={`${num(overview.recorded_trades)} recorded trades`} small />
        <Stat label="Priced trade share" value={overview.priced_trade_share === null || overview.priced_trade_share === undefined ? '—' : `${(Number(overview.priced_trade_share) * 100).toFixed(1)}%`} meta="trades with a usable price" small />
        <Stat label="Method" value="cost basis" small meta="average cost, no fabricated profits" />
      </div>

      <Card title="Top wallets by PNL" sub="Realized + unrealized from on-chain swaps" flush>
        <Status loading={loading && !data} error={error}>
          <div className="table-wrap" style={{ maxHeight: 560 }}>
            <table>
              <thead>
                <tr><th>Wallet</th><th>Chain</th><th className="right">Invested</th><th className="right">Realized</th><th className="right">Unrealized</th><th className="right">Total PNL</th><th className="right">Win rate</th><th className="right">Trades</th></tr>
              </thead>
              <tbody>
                {board.map((w, i) => (
                  <tr key={`${w.wallet}-${i}`}>
                    <td className="mono small">{short(w.wallet, 8, 6)}</td>
                    <td className="small">{chainLabel(w.chain)}</td>
                    <td className="right mono small">{usd(w.invested)}</td>
                    <td className={`right mono small ${Number(w.realized) >= 0 ? 'pos' : 'neg'}`}>{usd(w.realized)}</td>
                    <td className={`right mono small ${Number(w.unrealized) >= 0 ? 'pos' : 'neg'}`}>{usd(w.unrealized)}</td>
                    <td className={`right mono small ${Number(w.total_pnl) >= 0 ? 'pos' : 'neg'}`}>{usd(w.total_pnl)}</td>
                    <td className="right small">{w.win_rate === null || w.win_rate === undefined ? '—' : `${(Number(w.win_rate) * 100).toFixed(0)}%`}</td>
                    <td className="right small dim">{num(w.trades)}</td>
                  </tr>
                ))}
                {board.length === 0 && !loading && (
                  <tr><td colSpan={8}><div className="empty">No wallet PNL yet — positions are computed from indexed swaps.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Status>
      </Card>
    </>
  );
}

/* -------------------------------------------------------------- wallets */

export function Wallets() {
  const chains = useFetch(() => endpoints.chains(), []);
  const [chain, setChain] = useState('solana');
  const [address, setAddress] = useState('');
  const [target, setTarget] = useState(null);

  const detail = useFetch(
    () => (target ? endpoints.wallet(target.chain, target.address) : Promise.resolve(null)),
    [target?.chain, target?.address],
  );

  const pnl = detail.data?.pnl;
  const history = detail.data?.history || [];

  return (
    <>
      <Card title="Wallet tracker" sub="Look up any wallet's recorded positions and trade history">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label="Chain">
            {(chains.data?.chains || []).map((c) => <option key={c.id} value={c.id}>{chainLabel(c.id)}</option>)}
          </select>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Wallet address"
            style={{ flex: 1, minWidth: 280 }}
            onKeyDown={(e) => { if (e.key === 'Enter' && address.trim()) setTarget({ chain, address: address.trim() }); }}
          />
          <button type="button" className="btn primary" disabled={!address.trim()} onClick={() => setTarget({ chain, address: address.trim() })}>
            Track wallet
          </button>
        </div>
      </Card>

      {target && (
        <div className="grid split">
          <Card title="Positions" sub={`${short(target.address, 8, 6)} · ${chainLabel(target.chain)}`} flush>
            <Status loading={detail.loading && !pnl} error={detail.error}>
              <div className="grid k3" style={{ padding: 14, gap: 10 }}>
                <Stat label="Total PNL" value={usd(pnl?.total_pnl)} small tone={Number(pnl?.total_pnl) >= 0 ? 'pos' : 'neg'} />
                <Stat label="Realized" value={usd(pnl?.realized)} small tone={Number(pnl?.realized) >= 0 ? 'pos' : 'neg'} />
                <Stat label="Unrealized" value={usd(pnl?.unrealized)} small tone={Number(pnl?.unrealized) >= 0 ? 'pos' : 'neg'} />
              </div>
              <div className="table-wrap" style={{ maxHeight: 420 }}>
                <table>
                  <thead>
                    <tr><th>Token</th><th className="right">Bought</th><th className="right">Remaining</th><th className="right">Avg entry</th><th className="right">Last</th><th className="right">PNL</th></tr>
                  </thead>
                  <tbody>
                    {(pnl?.positions || []).map((p, i) => (
                      <tr key={i}>
                        <td className="small">{p.symbol ? `$${p.symbol}` : short(p.token || p.address)}</td>
                        <td className="right mono small">{usd(p.invested)}</td>
                        <td className="right mono small">{p.remaining === null || p.remaining === undefined ? '—' : num(p.remaining, 2)}</td>
                        <td className="right mono small dim">{price(p.entry_price ?? p.avg_entry)}</td>
                        <td className="right mono small">{price(p.last_price ?? p.price)}</td>
                        <td className={`right mono small ${Number(p.total_pnl) >= 0 ? 'pos' : 'neg'}`}>{usd(p.total_pnl)}</td>
                      </tr>
                    ))}
                    {(pnl?.positions || []).length === 0 && <tr><td colSpan={6}><div className="empty">No recorded positions for this wallet.</div></td></tr>}
                  </tbody>
                </table>
              </div>
              {pnl?.method && <div className="small dim" style={{ padding: '10px 16px' }}>{pnl.method}</div>}
            </Status>
          </Card>

          <Card title="Trade history" sub="Indexed swaps" flush>
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              {history.map((h, i) => (
                <div className="feed-row" key={i}>
                  <Pill tone={h.side === 'sell' ? 'red' : 'green'}>{h.side || 'swap'}</Pill>
                  <span className="truncate" style={{ flex: 1 }}>{h.symbol ? `$${h.symbol}` : short(h.token)}</span>
                  <span className="small mono dim">{usd(h.usd ?? h.value_usd)}</span>
                  <span className="small dim nowrap">{ago(h.ts)}</span>
                </div>
              ))}
              {history.length === 0 && <div className="empty">No swaps recorded.</div>}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------- security */

export function Security() {
  const { data, error, loading } = useFetch(() => endpoints.security(), [], { poll: 30000 });
  const summary = data?.summary || [];
  const flagged = data?.flagged || [];
  const total = summary.reduce((a, s) => a + Number(s.c || 0), 0);
  const levelTone = { low: 'green', medium: 'amber', high: 'red', critical: 'red', unchecked: 'muted' };

  return (
    <>
      <div className="grid k4">
        <Stat label="Tokens analysed" value={num(total)} meta="risk engine coverage" small />
        {['low', 'medium', 'high'].map((lvl) => {
          const row = summary.find((s) => s.level === lvl);
          return <Stat key={lvl} label={`${lvl} risk`} value={num(row?.c || 0)} small tone={lvl === 'low' ? 'pos' : lvl === 'high' ? 'neg' : ''} meta={`${total ? (((row?.c || 0) / total) * 100).toFixed(0) : 0}% of analysed`} />;
        })}
      </div>

      <div className="grid split">
        <Card title="Highest risk tokens" sub="Ranked by composite risk score" flush>
          <Status loading={loading && !data} error={error}>
            <div className="table-wrap" style={{ maxHeight: 520 }}>
              <table>
                <thead>
                  <tr><th>Token</th><th>Chain</th><th>Risk</th><th className="right">Score</th><th className="right">Liquidity</th><th className="right">Market cap</th></tr>
                </thead>
                <tbody>
                  {flagged.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="token-cell">
                          <div className="token-badge">{(t.symbol || '?').slice(0, 3).toUpperCase()}</div>
                          <div style={{ minWidth: 0 }}>
                            <div className="token-name truncate">{t.symbol ? `$${t.symbol}` : short(t.address)}</div>
                            <div className="token-sym">{t.name || short(t.address)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="small">{chainLabel(t.chain)}</td>
                      <td><RiskBadge level={t.risk_level} /></td>
                      <td className="right mono small">{num(t.risk_score)}</td>
                      <td className="right mono small">{usd(t.liquidity_usd)}</td>
                      <td className="right mono small">{usd(t.market_cap)}</td>
                    </tr>
                  ))}
                  {flagged.length === 0 && !loading && <tr><td colSpan={6}><div className="empty">No analysed tokens yet. Analysis runs once liquidity or holders are observed.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </Status>
        </Card>

        <Card title="Risk distribution" sub="Signals never decide safety alone">
          <div className="ladder">
            {summary.map((s) => (
              <div className="ladder-row" key={s.level}>
                <span className="ladder-label"><Pill tone={levelTone[s.level] || 'muted'}>{s.level}</Pill></span>
                <Progress value={s.c} max={Math.max(1, total)} />
                <span className="ladder-count">{num(s.c)}</span>
              </div>
            ))}
            {summary.length === 0 && <div className="empty">No analysis recorded yet.</div>}
          </div>
          <div className="small dim" style={{ marginTop: 14 }}>
            Checks include mint and freeze authority, ownership, proxy/upgradeability, holder concentration, creator holdings,
            bundled buys, sniper wallets, honeypot indicators and creator history. Each finding carries an explanation.
          </div>
        </Card>
      </div>
    </>
  );
}
