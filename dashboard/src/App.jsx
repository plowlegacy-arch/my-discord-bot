import React, { useEffect, useMemo, useState } from 'react';
import { endpoints, getGuildId, setGuildId } from './api.js';
import { useFetch, Pill } from './ui.jsx';
import Overview from './pages/Overview.jsx';
import Scanner from './pages/Scanner.jsx';
import Tokens from './pages/Tokens.jsx';
import { Multipliers, Pnl, Wallets, Security } from './pages/Intel.jsx';
import { Economy, Members, Casino, Businesses, Marketplace } from './pages/Economy.jsx';
import { Giveaways, Settings, Audit, ApiStatus } from './pages/Ops.jsx';

const NAV = [
  {
    label: 'Intelligence',
    items: [
      { id: 'overview', label: 'Overview', icon: '◈' },
      { id: 'scanner', label: 'Live Chain Scanner', icon: '◎' },
      { id: 'tokens', label: 'All New Tokens', icon: '◇' },
      { id: 'multipliers', label: 'Unlimited Multipliers', icon: '↑' },
      { id: 'security', label: 'Security Analysis', icon: '⚑' },
    ],
  },
  {
    label: 'Wallets',
    items: [
      { id: 'pnl', label: 'PNL Analytics', icon: '≋' },
      { id: 'wallets', label: 'Wallet Tracker', icon: '⌾' },
    ],
  },
  {
    label: 'Economy',
    items: [
      { id: 'economy', label: 'Economy', icon: '◉' },
      { id: 'members', label: 'Members', icon: '☰' },
      { id: 'casino', label: 'Casino Statistics', icon: '◆' },
      { id: 'businesses', label: 'Businesses', icon: '▤' },
      { id: 'marketplace', label: 'Marketplace', icon: '⇄' },
      { id: 'giveaways', label: 'Giveaways', icon: '★' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'settings', label: 'Server Configuration', icon: '⚙' },
      { id: 'audit', label: 'Audit Logs', icon: '≡' },
      { id: 'status', label: 'API & Chain Status', icon: '◌' },
    ],
  },
];

const TITLES = {
  overview: ['Overview', 'Multi-chain intelligence control room'],
  scanner: ['Live Chain Scanner', 'Direct on-chain discovery pipelines'],
  tokens: ['All New Tokens', 'Deployments, launches, liquidity and trading'],
  multipliers: ['Unlimited Multipliers', 'Baseline-anchored performance tracking'],
  security: ['Security Analysis', 'Transparent risk scoring per token'],
  pnl: ['PNL Analytics', 'Real wallet trading performance'],
  wallets: ['Wallet Tracker', 'Live tracked wallet activity'],
  economy: ['Economy Management', 'Server currency, supply and members'],
  members: ['Member Management', 'Balances, careers and inventories'],
  casino: ['Casino Statistics', 'Wagers, payouts and provable fairness'],
  businesses: ['Businesses', 'Ownership, income and upgrades'],
  marketplace: ['Marketplace', 'Player listings and auctions'],
  giveaways: ['Giveaways', 'Draws, entries and history'],
  settings: ['Server Configuration', 'Currency, alerts and permissions'],
  audit: ['Audit Logs', 'Administrative action trail'],
  status: ['API & Chain Status', 'RPC health, cursors and logs'],
};

function parseHash() {
  const raw = (window.location.hash || '#/overview').replace(/^#\/?/, '');
  const [route, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  return { route: route || 'overview', params };
}

export default function App() {
  const [{ route, params }, setHash] = useState(parseHash());
  const [navOpen, setNavOpen] = useState(false);
  const [guild, setGuild] = useState(getGuildId());
  const [guildDraft, setGuildDraft] = useState(getGuildId());

  useEffect(() => {
    const onHash = () => {
      setHash(parseHash());
      setNavOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.location.hash = '#/overview';
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const health = useFetch(() => endpoints.health(), [], { poll: 20000 });
  const chains = useFetch(() => endpoints.chains(), [], { poll: 30000 });

  const go = (id) => {
    window.location.hash = `#/${id}`;
  };

  const chainList = chains.data?.chains || [];
  const liveChains = chainList.filter((c) => c.status === 'live').length;
  const bot = health.data?.bot || {};

  const page = useMemo(() => {
    switch (route) {
      case 'scanner': return <Scanner params={params} chains={chainList} reloadChains={chains.reload} />;
      case 'tokens': return <Tokens params={params} chains={chainList} />;
      case 'multipliers': return <Multipliers />;
      case 'security': return <Security />;
      case 'pnl': return <Pnl />;
      case 'wallets': return <Wallets />;
      case 'economy': return <Economy onGuildSaved={(g) => setGuild(g)} />;
      case 'members': return <Members />;
      case 'casino': return <Casino />;
      case 'businesses': return <Businesses />;
      case 'marketplace': return <Marketplace />;
      case 'giveaways': return <Giveaways />;
      case 'settings': return <Settings onGuildSaved={(g) => setGuild(g)} />;
      case 'audit': return <Audit />;
      case 'status': return <ApiStatus health={health.data} chains={chainList} />;
      default: return <Overview chains={chainList} onNavigate={go} />;
    }
  }, [route, params.toString(), chainList, health.data]);

  const [title, subtitle] = TITLES[route] || TITLES.overview;

  return (
    <div className="shell">
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">TS</div>
          <div>
            <div className="brand-name">TRENCH SCANNER</div>
            <div className="brand-sub">Multi-chain intelligence</div>
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item ${route === item.id ? 'active' : ''}`}
                  onClick={() => go(item.id)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                  {item.id === 'status' && (
                    <span className="nav-count">{liveChains}/{chainList.length || '—'}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="dim">Scanner</span>
            <Pill tone={health.data?.ok ? 'green' : 'red'} dot>
              {health.data?.ok ? 'online' : 'offline'}
            </Pill>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="dim">Discord bot</span>
            <Pill tone={bot.ready ? 'green' : bot.enabled ? 'amber' : 'muted'} dot>
              {bot.ready ? (bot.tag || 'ready') : bot.enabled ? 'connecting' : 'not configured'}
            </Pill>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="dim">Chains live</span>
            <span className="mono">{liveChains}</span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button type="button" className="btn ghost mobile-bar" onClick={() => setNavOpen(true)}>☰</button>
          <div>
            <div className="crumb">{subtitle}</div>
            <h1>{title}</h1>
          </div>
          <span className="topbar-spacer" />
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              setGuildId(guildDraft.trim());
              setGuild(guildDraft.trim());
              window.location.reload();
            }}
          >
            <input
              type="text"
              value={guildDraft}
              onChange={(e) => setGuildDraft(e.target.value)}
              placeholder="Discord guild id"
              aria-label="Discord guild id"
              style={{ width: 168 }}
            />
            <button type="submit" className="btn">Set server</button>
          </form>
        </header>

        <main className="content">
          {guild && (
            <div className="card tight" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Pill tone="blue">guild {guild}</Pill>
              <span className="small dim">Economy, casino and giveaway data is scoped to this server.</span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setGuildId('');
                  setGuildDraft('');
                  setGuild('');
                  window.location.reload();
                }}
              >
                Clear
              </button>
            </div>
          )}
          {page}
        </main>
      </div>
    </div>
  );
}
