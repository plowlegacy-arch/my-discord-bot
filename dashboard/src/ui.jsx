import React, { useCallback, useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------- data hook */

export function useFetch(loader, deps = [], { poll = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const alive = useRef(true);

  const run = useCallback(async () => {
    try {
      const data = await loader();
      if (alive.current) setState({ data, error: null, loading: false });
    } catch (err) {
      if (alive.current) setState((s) => ({ data: s.data, error: err.message, loading: false }));
    }
  }, deps);

  useEffect(() => {
    alive.current = true;
    setState((s) => ({ ...s, loading: true }));
    run();
    let timer = null;
    if (poll) timer = setInterval(run, poll);
    return () => {
      alive.current = false;
      if (timer) clearInterval(timer);
    };
  }, [run, poll]);

  return { ...state, reload: run };
}

/* ------------------------------------------------------------ formatting */

export const num = (v, digits = 0) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
};

export function usd(v, { compact = true } = {}) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n === 0) return '$0';
  if (compact && Math.abs(n) >= 1000) {
    const units = [
      [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K'],
    ];
    for (const [size, suffix] of units) {
      if (Math.abs(n) >= size) {
        const scaled = n / size;
        return `$${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)}${suffix}`;
      }
    }
  }
  if (Math.abs(n) < 0.01) return `$${n.toPrecision(3)}`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export function price(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n === 0) return '$0';
  if (n >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toExponential(2)}`;
}

export function mult(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n >= 1000) return `${num(n, 0)}x`;
  return `${n.toFixed(n >= 10 ? 1 : 2)}x`;
}

export function ago(ts) {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() - Number(ts));
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function duration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const short = (addr, head = 5, tail = 4) => {
  if (!addr) return '—';
  const s = String(addr);
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
};

export const time = (ts) => (ts ? new Date(Number(ts)).toLocaleTimeString('en-US', { hour12: false }) : '—');

export const datetime = (ts) =>
  ts ? new Date(Number(ts)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const chainLabel = (id) => {
  const map = {
    solana: 'SOLANA', ethereum: 'ETHEREUM', bnb: 'BNB', base: 'BASE', arbitrum: 'ARBITRUM',
    optimism: 'OPTIMISM', polygon: 'POLYGON', avalanche: 'AVAX', sui: 'SUI', ton: 'TON',
    aptos: 'APTOS', sonic: 'SONIC', monad: 'MONAD', sei: 'SEI', hyperevm: 'HYPEREVM',
  };
  return map[id] || String(id || '').toUpperCase();
};

/* ------------------------------------------------------------- components */

export function Card({ title, sub, actions, children, className = '', flush = false, tight = false }) {
  return (
    <section className={`card ${flush ? 'flush' : ''} ${tight ? 'tight' : ''} ${className}`}>
      {(title || actions) && (
        <header className="card-head" style={flush ? { padding: '14px 16px 0', marginBottom: 10 } : undefined}>
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          <span className="spacer" />
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, meta, tone = '', small = false, children }) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${small ? 'sm' : ''} ${tone}`}>{value}</span>
      {meta && <span className="stat-meta">{meta}</span>}
      {children}
    </div>
  );
}

export function Pill({ tone = '', children, dot = false }) {
  return (
    <span className={`pill ${tone}`}>
      {dot && <i className={`dot ${tone === 'green' ? 'live' : tone === 'red' ? 'dead' : ''}`} />}
      {children}
    </span>
  );
}

export function Status({ loading, error, empty, emptyText = 'Nothing here yet.', children }) {
  if (loading && !children) return <div className="loading">Loading live data…</div>;
  if (error) return <div className="error-box">{error}</div>;
  if (empty) return <div className="empty">{emptyText}</div>;
  return children;
}

export function Sparkline({ points = [], width = 220, height = 46, color = '#14e0a0' }) {
  const values = points.filter((p) => Number.isFinite(Number(p))).map(Number);
  if (values.length < 2) return <div className="dim small">no history</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const coords = values.map((v, i) => [i * step, height - ((v - min) / span) * (height - 6) - 3]);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const id = `g${Math.round(min * 1e6) % 99999}${values.length}`;
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="price history">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Bars({ values = [] }) {
  const max = Math.max(1, ...values.map(Number));
  return (
    <div className="bars">
      {values.map((v, i) => (
        <span key={i} style={{ height: `${Math.max(4, (Number(v) / max) * 100)}%` }} title={String(v)} />
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        return (
          <button key={val} type="button" className={value === val ? 'on' : ''} onClick={() => onChange(val)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function RiskBadge({ level, score }) {
  const tone = level === 'critical' || level === 'high' ? 'red' : level === 'medium' ? 'amber' : level ? 'green' : 'muted';
  if (!level) return <Pill tone="muted">pending</Pill>;
  return <Pill tone={tone}>{level}{score !== null && score !== undefined ? ` · ${score}` : ''}</Pill>;
}

export function Progress({ value = 0, max = 100 }) {
  const pct = Math.max(0, Math.min(100, (Number(value) / (Number(max) || 1)) * 100));
  return <div className="progress"><i style={{ width: `${pct}%` }} /></div>;
}
