import React, { useEffect, useMemo, useRef, useState } from 'react';
import { endpoints } from '../api.js';
import { useFetch, Card, Pill, Stat, ago, chainLabel, num, short, time, usd, Segmented } from '../ui.jsx';

const EVENT_LABEL = {
  deploy: 'deployment', mint: 'mint', launch: 'launch', liquidity: 'liquidity',
  trade: 'first trade', migrate: 'migration', graduate: 'graduation',
};

function ChainCard({ chain, onScan, scanning }) {
  const configured = Boolean(chain.configured);
  const state = !configured ? 'unconfigured' : chain.last_error ? 'error' : chain.busy ? 'scanning' : 'live';
  const tone = state === 'live' ? 'green' : state === 'error' ? 'red' : state === 'scanning' ? 'blue' : 'muted';
  const pct = chain.head_block && chain.last_block
    ? Math.min(100, (Number(chain.last_block) / Number(chain.head_block)) * 100)
    : 0;

  return (
    <div className="card tight">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <strong style={{ fontSize: 13 }}>{chainLabel(chain.id)}</strong>
          <span className="dim small">{chain.family}</span>
        </div>
        <Pill tone={tone} dot>{state}</Pill>
      </div>

      <div className="progress"><i style={{ width: `${Math.max(2, pct)}%` }} /></div>
      <div className="row small dim mono" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <span>{chain.last_block ? `#${num(chain.last_block)}` : 'no cursor'}</span>
        <span>{chain.head_block ? `head #${num(chain.head_block)}` : 'head —'}</span>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <span className="small dim">{chain.last ? `scanned ${ago(chain.last)}` : 'never scanned'}</span>
        <button
          type="button"
          className="btn"
          disabled={!configured || scanning}
          onClick={() => onScan(chain.id)}
          title={configured ? 'Trigger an immediate backfill pass' : `Set ${chain.rpc_env} to enable`}
        >
          {scanning ? 'Scanning…' : 'Scan now'}
        </button>
      </div>
      {chain.last_error && <div className="small" style={{ color: 'var(--red)', marginTop: 8 }}>{String(chain.last_error).slice(0, 120)}</div>}
      {!configured && <div className="small dim" style={{ marginTop: 8 }}>Requires {chain.rpc_env}</div>}
    </div>
  );
}

export default function Scanner({ chains, reloadChains }) {
  const [chainFilter, setChainFilter] = useState('');
  const [scanningId, setScanningId] = useState('');
  const [streaming, setStreaming] = useState(true);
  const [live, setLive] = useState([]);
  const [error, setError] = useState('');
  const esRef = useRef(null);

  const events = useFetch(() => endpoints.events({ chain: chainFilter || undefined, limit: 40 }), [chainFilter], { poll: 12000 });
  const logs = useFetch(() => endpoints.logs(chainFilter || undefined), [chainFilter], { poll: 9000 });

  useEffect(() => {
    if (!streaming) {
      if (esRef.current) esRef.current.close();
      return undefined;
    }
    let source;
    try {
      source = new EventSource('/api/stream');
      esRef.current = source;
      source.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data);
          setLive((prev) => [{ ...parsed, received_at: Date.now() }, ...prev].slice(0, 40));
        } catch {
          /* heartbeat or malformed frame */
        }
      };
      source.onerror = () => setError('Live stream interrupted — retrying automatically.');
    } catch (err) {
      setError(err.message);
    }
    return () => {
      if (source) source.close();
    };
  }, [streaming]);

  const scan = async (id) => {
    setScanningId(id);
    setError('');
    try {
      await endpoints.scanChain(id);
      await reloadChains();
    } catch (err) {
      setError(err.message);
    } finally {
      setScanningId('');
    }
  };

  const configured = chains.filter((c) => c.configured);
  const liveCount = configured.filter((c) => !c.last_error).length;
  const cursorSum = chains.reduce((a, c) => a + Number(c.last_block || 0), 0);

  const chainOptions = useMemo(
    () => [{ value: '', label: 'All chains' }, ...chains.map((c) => ({ value: c.id, label: chainLabel(c.id) }))],
    [chains],
  );

  return (
    <>
      <div className="grid k4">
        <Stat label="Pipelines configured" value={`${configured.length} / ${chains.length}`} meta="RPC-backed discovery" />
        <Stat label="Healthy now" value={num(liveCount)} meta={<><span className="dot live" /> independent cursors</>} />
        <Stat label="Blocks observed" value={num(cursorSum)} meta="cumulative last-block cursors" small />
        <Stat
          label="Live stream"
          value={streaming ? 'subscribed' : 'paused'}
          small
          meta={<button type="button" className="btn ghost" onClick={() => setStreaming((v) => !v)}>{streaming ? 'Pause' : 'Resume'}</button>}
        />
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="grid k3">
        {chains.map((c) => (
          <ChainCard key={c.id} chain={c} onScan={scan} scanning={scanningId === c.id} />
        ))}
      </div>

      <div className="grid split">
        <Card
          title="On-chain event feed"
          sub={chainFilter ? `Filtered to ${chainLabel(chainFilter)}` : 'All pipelines'}
          flush
          actions={<Segmented options={chainOptions.slice(0, 6)} value={chainFilter} onChange={setChainFilter} />}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Token</th><th>Chain</th><th>Event</th><th>Creator</th><th className="right">MC</th><th className="right">When</th>
                </tr>
              </thead>
              <tbody>
                {(events.data?.events || []).map((e) => (
                  <tr key={`${e.id}-${e.ts}`}>
                    <td>
                      <div className="token-cell">
                        <div className="token-badge">{(e.symbol || '?').slice(0, 3).toUpperCase()}</div>
                        <div style={{ minWidth: 0 }}>
                          <div className="token-name truncate">{e.symbol ? `$${e.symbol}` : 'unnamed token'}</div>
                          <div className="token-sym">{short(e.address, 8, 6)}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className="small">{chainLabel(e.chain)}</span></td>
                    <td><Pill tone={e.type === 'deploy' ? 'blue' : e.type === 'liquidity' ? 'green' : e.type === 'trade' ? 'amber' : 'muted'}>{EVENT_LABEL[e.type] || e.type}</Pill></td>
                    <td className="mono small dim">{short(e.creator || e.token_creator)}</td>
                    <td className="right mono small">{usd(e.market_cap)}</td>
                    <td className="right small dim nowrap">{ago(e.ts)}</td>
                  </tr>
                ))}
                {!events.loading && (events.data?.events || []).length === 0 && (
                  <tr><td colSpan={6}><div className="empty">No events yet. Pipelines record deployments as soon as an RPC is configured.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Realtime frames" sub="Server-sent events from the indexer" actions={<Pill tone={streaming ? 'green' : 'muted'} dot>{streaming ? 'live' : 'paused'}</Pill>}>
            {live.length === 0 ? (
              <div className="empty">Waiting for the next frame…</div>
            ) : (
              <div style={{ maxHeight: 240, overflow: 'auto' }}>
                {live.map((f, i) => (
                  <div className="scan-line" key={`${f.received_at}-${i}`}>
                    <time>{time(f.received_at)}</time>
                    <span style={{ flex: 1 }} className="truncate">
                      {f.type ? `${chainLabel(f.chain)} ${EVENT_LABEL[f.type] || f.type} ${f.symbol ? `$${f.symbol}` : short(f.address)}` : (f.message || JSON.stringify(f).slice(0, 90))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Indexer log" sub="Chain-scoped activity" actions={<Pill tone="muted">{logs.data?.logs?.length || 0}</Pill>}>
            <div style={{ maxHeight: 320, overflow: 'auto' }}>
              {(logs.data?.logs || []).map((l, i) => (
                <div className="scan-line" key={`${l.ts}-${i}`}>
                  <time>{time(l.ts)}</time>
                  <span className="dim">[{l.chain || 'core'}]</span>
                  <span className="truncate" style={{ flex: 1 }}>{l.message || l.msg}</span>
                </div>
              ))}
              {(logs.data?.logs || []).length === 0 && <div className="empty">No log entries.</div>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
