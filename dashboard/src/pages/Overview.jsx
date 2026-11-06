import React from 'react';
import { endpoints } from '../api.js';
import { useFetch, Card, Stat, Pill, Status, Sparkline, Bars, usd, num, ago, chainLabel, short, mult, price, time } from '../ui.jsx';

const EVENT_LABEL = {
  deploy: 'deployment',
  mint: 'mint',
  launch: 'launch',
  liquidity: 'liquidity',
  trade: 'first trade',
  migrate: 'migration',
  graduate: 'graduation',
};

function ChainStrip({ chains }) {
  if (!chains.length) return <div className="empty">No chain pipelines registered.</div>;
  return (
    <div>
      {chains.map((c) => {
        const status = c.configured ? (c.last_error ? 'error' : c.live ? 'live' : 'idle') : 'unconfigured';
        const tone = status === 'live' ? 'green' : status === 'error' ? 'red' : status === 'idle' ? 'amber' : 'muted';
        const progress = c.head_block && c.last_block ? (Number(c.last_block) / Number(c.head_block)) * 100 : 0;
        return (
          <div className="chain-row" key={c.id}>
            <div className="row" style={{ gap: 8 }}>
              <Pill tone={tone} dot>{status}</Pill>
              <strong style={{ fontSize: 12.5 }}>{chainLabel(c.id)}</strong>
              <span className="dim small">{c.family}</span>
            </div>
            <span className="mono small dim">{c.configured ? (c.busy ? 'scanning' : 'ready') : 'no rpc'}</span>
            <div>
              <div className="progress"><i style={{ width: `${Math.min(100, Math.max(2, progress))}%` }} /></div>
              <div className="small dim mono" style={{ marginTop: 4 }}>
                {c.last_block ? `#${num(c.last_block)}` : 'no cursor'}
                {c.head_block ? ` / ${num(c.head_block)}` : ''}
              </div>
            </div>
            <span className="small dim right nowrap">{c.last ? ago(c.last) : 'never'}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Overview({ chains, onNavigate }) {
  const stats = useFetch(() => endpoints.stats(), [], { poll: 15000 });
  const events = useFetch(() => endpoints.events({ limit: 12 }), [], { poll: 15000 });
  const logs = useFetch(() => endpoints.logs({ limit: 14 }), [], { poll: 10000 });
  const economy = useFetch(() => endpoints.economyOverview(), [], { poll: 30000 });

  const s = stats.data || {};
  const t = s.totals || {};
  const risk = s.risk || [];
  const riskOf = (level) => (risk.find((r) => r.level === level) || {}).c || 0;
  const bot = s.bot || {};
  const economyData = economy.data || {};
  const bets = economyData.bets || {};

  return (
    <>
      <div className="grid k4">
        <Stat
          label="Tokens discovered"
          value={num(t.tokens ?? s.tokens ?? 0)}
          meta={<><span className="dot live" /> {num(t.last24h || 0)} in the last 24h</>}
        />
        <Stat
          label="Actively tradable"
          value={num(t.trading || 0)}
          meta={`${num(t.with_liquidity || 0)} with recorded liquidity`}
        />
        <Stat
          label="Aggregate liquidity"
          value={usd(t.liquidity || 0)}
          meta={`Volume ${usd(s.volume || 0)}`}
        />
        <Stat
          label="Multipliers tracked"
          value={num(s.milestones || 0)}
          meta={<>{num(riskOf('high') + riskOf('critical'))} high-risk tokens flagged</>}
        />
      </div>

      <div className="grid split">
        <Card
          title="Discovery velocity"
          sub="24h event mix across every live pipeline"
          actions={<Pill tone="green" dot>streaming</Pill>}
        >
          <div className="grid k2" style={{ alignItems: 'end' }}>
            <div>
              <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
                {(s.events || []).length === 0 && <span className="dim small">No events recorded in the last 24 hours yet.</span>}
                {(s.events || []).map((e) => (
                  <div key={e.type} className="stat" style={{ gap: 2 }}>
                    <span className="stat-label">{EVENT_LABEL[e.type] || e.type}</span>
                    <span className="mono" style={{ fontSize: 17 }}>{num(e.c)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Bars values={(s.events || []).map((e) => e.c)} />
              <div className="small dim" style={{ marginTop: 6 }}>Relative event volume</div>
            </div>
          </div>
        </Card>

        <Card
          title="Runtime"
          sub="Bot and indexer health"
          actions={<Pill tone={bot.ready ? 'green' : 'muted'} dot>{bot.ready ? 'bot ready' : bot.enabled ? 'connecting' : 'bot off'}</Pill>}
        >
          <dl className="kv">
            <dt>Guilds</dt><dd>{num(bot.guilds || 0)}</dd>
            <dt>Latency</dt><dd>{bot.ping !== undefined ? `${bot.ping} ms` : '—'}</dd>
            <dt>Commands</dt><dd>{num(bot.commands || 0)} registered</dd>
            <dt>Alerts</dt><dd>{num(bot.alerts_sent || 0)} dispatched</dd>
            <dt>Chains live</dt><dd>{chains.filter((c) => c.configured && !c.last_error).length} / {chains.length}</dd>
          </dl>
        </Card>
      </div>

      <div className="grid split">
        <Card
          title="Latest discoveries"
          sub="Newest on-chain token events"
          flush
          actions={<button type="button" className="btn ghost" onClick={() => onNavigate('tokens')}>View all</button>}
        >
          <Status {...events} empty={!events.loading && (events.data?.events || []).length === 0} emptyText="The scanner is connected and waiting for the next on-chain deployment.">
            <div className="table-wrap slim">
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Chain</th>
                    <th>Event</th>
                    <th>Stage</th>
                    <th className="right">MC</th>
                    <th className="right">Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {(events.data?.events || []).map((e) => (
                    <tr key={`${e.id}-${e.ts}`}>
                      <td>
                        <div className="token-cell">
                          <div className="token-badge">{(e.symbol || '?').slice(0, 3).toUpperCase()}</div>
                          <div style={{ minWidth: 0 }}>
                            <div className="token-name truncate">{e.symbol ? `$${e.symbol}` : short(e.address)}</div>
                            <div className="token-sym">{short(e.address, 6, 4)}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className="small">{chainLabel(e.chain)}</span></td>
                      <td><Pill tone={e.type === 'deploy' ? 'blue' : e.type === 'liquidity' ? 'green' : 'muted'}>{EVENT_LABEL[e.type] || e.type}</Pill></td>
                      <td><span className="small dim">{e.stage || 'deployed'}</span></td>
                      <td className="right mono small">{usd(e.market_cap)}</td>
                      <td className="right small dim nowrap">{ago(e.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Status>
        </Card>

        <Card
          title="Top performers"
          sub="Anchored to each token's first recorded baseline"
          actions={<button type="button" className="btn ghost" onClick={() => onNavigate('multipliers')}>Multipliers</button>}
        >
          {(s.top_movers || []).length === 0 ? (
            <div className="empty">No priced tokens yet. Multipliers appear once a baseline price is recorded.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(s.top_movers || []).map((m) => (
                <div key={m.id} className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                  <div className="row" style={{ gap: 9, minWidth: 0 }}>
                    <div className="token-badge">{(m.symbol || '?').slice(0, 3).toUpperCase()}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="token-name truncate">{m.symbol ? `$${m.symbol}` : short(m.address)}</div>
                      <div className="token-sym">{chainLabel(m.chain)} · {usd(m.market_cap)}</div>
                    </div>
                  </div>
                  <span className="mono pos" style={{ fontSize: 13 }}>{mult(m.multiplier)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid split">
        <Card
          title="Chain pipelines"
          sub="Independent cursors, heads and recovery state"
          actions={<button type="button" className="btn ghost" onClick={() => onNavigate('status')}>Status</button>}
        >
          <ChainStrip chains={chains} />
        </Card>

        <Card title="Scanner log" sub="Most recent indexer activity">
          {(logs.data?.logs || []).length === 0 ? (
            <div className="empty">No log entries yet.</div>
          ) : (
            <div>
              {(logs.data?.logs || []).map((l, i) => (
                <div className="scan-line" key={`${l.ts}-${i}`}>
                  <time>{time(l.ts)}</time>
                  <span className="dim">[{l.chain || 'core'}]</span>
                  <span className="truncate" style={{ flex: 1 }}>{l.message || l.msg}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid k3">
        <Card title="Economy supply" sub="Server-scoped virtual currency">
          <Stat label="Circulating" value={num(economyData.supply || 0)} small meta={`${num(economyData.members || 0)} members`} />
          <div style={{ height: 10 }} />
          <div className="row" style={{ justifyContent: 'space-between' }} className="small dim">
            <span>Wallet {num(economyData.cash || 0)}</span>
            <span>Bank {num(economyData.bank || 0)}</span>
          </div>
        </Card>
        <Card title="Casino activity" sub="All wagers, all games">
          <Stat label="Wagered" value={num(bets.w || 0)} small meta={`${num(bets.c || 0)} bets`} />
          <div style={{ height: 10 }} />
          <div className="small dim">Payouts {num(bets.p || 0)}</div>
        </Card>
        <Card title="Security posture" sub="Risk distribution across discovered tokens">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {['critical', 'high', 'medium', 'low', 'unchecked'].map((level) => (
              <div key={level} className="row" style={{ justifyContent: 'space-between' }}>
                <Pill tone={level === 'critical' || level === 'high' ? 'red' : level === 'medium' ? 'amber' : level === 'low' ? 'green' : 'muted'}>{level}</Pill>
                <span className="mono small">{num(riskOf(level))}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
