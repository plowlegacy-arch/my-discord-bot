import React, { useState } from 'react';
import { endpoints, setGuildId } from '../api.js';
import { useFetch, Card, Stat, Pill, Status, Segmented, Progress, usd, num, ago, chainLabel, short, datetime, price } from '../ui.jsx';

const RESERVED = new Set(['guild_id', 'created_at', 'updated_at', 'id']);
const LABELS = {
  currency: 'Currency name', currency_name: 'Currency name', symbol: 'Symbol', currency_symbol: 'Symbol',
  daily: 'Daily reward', weekly: 'Weekly reward', monthly: 'Monthly reward',
  work_cooldown: 'Work cooldown (s)', work_min: 'Work min payout', work_max: 'Work max payout',
  casino_min: 'Casino min bet', casino_max: 'Casino max bet', casino_min_bet: 'Casino min bet', casino_max_bet: 'Casino max bet',
  starting_balance: 'Starting balance', bank_capacity: 'Bank capacity', tax: 'Transfer tax', transfer_tax: 'Transfer tax',
  alerts_channel: 'Alert channel', economy_channel: 'Economy channel', theme: 'Theme', locale: 'Locale',
};

const label = (k) => LABELS[k] || k.replace(/_/g, ' ');

/* --------------------------------------------------------------- economy */

export function Economy({ onGuildSaved }) {
  const overview = useFetch(() => endpoints.economy(), [], { poll: 20000 });
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [err, setErr] = useState('');

  const cfg = draft || overview.data?.config || {};
  const editable = Object.entries(cfg).filter(([k, v]) => !RESERVED.has(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'));

  const set = (k, v) => setDraft({ ...cfg, [k]: v });

  const save = async () => {
    setSaving(true);
    setErr('');
    setSaved('');
    try {
      const patch = {};
      for (const [k, v] of Object.entries(draft || {})) if (!RESERVED.has(k)) patch[k] = v;
      await endpoints.saveConfig(patch);
      setSaved('Saved — the bot picks up the new configuration immediately.');
      setDraft(null);
      await overview.reload();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const data = overview.data || {};
  const bets = data.bets || {};

  return (
    <>
      <div className="grid k4">
        <Stat label="Members" value={num(data.members)} meta="independent per-server wallet" small />
        <Stat label="Currency supply" value={num(data.supply)} meta={`${num(data.cash)} cash · ${num(data.bank)} bank`} small />
        <Stat label="Transactions" value={num(data.transactions)} meta="audited ledger entries" small />
        <Stat label="Casino handle" value={num(bets.w)} small meta={`${num(bets.c)} bets · ${num(bets.p)} paid out`} />
      </div>

      <div className="grid split">
        <Card
          title="Server economy configuration"
          sub="Currency, rewards, limits and channels"
          actions={
            <div className="row" style={{ gap: 8 }}>
              {draft && <button type="button" className="btn ghost" onClick={() => setDraft(null)}>Reset</button>}
              <button type="button" className="btn primary" disabled={!draft || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          }
        >
          <Status loading={overview.loading && !overview.data} error={overview.error}>
            {err && <div className="error-box" style={{ marginBottom: 10 }}>{err}</div>}
            {saved && <div className="ok-box" style={{ marginBottom: 10 }}>{saved}</div>}
            <div className="form-grid">
              {editable.map(([k, v]) => (
                <label key={k} className="field">
                  <span>{label(k)}</span>
                  {typeof v === 'boolean' ? (
                    <select value={String(v)} onChange={(e) => set(k, e.target.value === 'true')}>
                      <option value="true">enabled</option>
                      <option value="false">disabled</option>
                    </select>
                  ) : (
                    <input
                      value={cfg[k] ?? ''}
                      inputMode={typeof v === 'number' ? 'numeric' : 'text'}
                      onChange={(e) => set(k, typeof v === 'number' ? Number(e.target.value.replace(/[^\d.-]/g, '')) : e.target.value)}
                    />
                  )}
                </label>
              ))}
              {editable.length === 0 && <div className="empty">Configuration loads from the server once a guild is selected.</div>}
            </div>
          </Status>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Richest members" sub="Cash + bank" flush>
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {(data.leaderboard || []).map((m, i) => (
                <div className="feed-row" key={m.user_id || i}>
                  <span className="rank">{i + 1}</span>
                  <span className="truncate" style={{ flex: 1 }}>{m.username || short(m.user_id, 6, 4)}</span>
                  <span className="mono small">{num(m.total ?? m.net_worth ?? (Number(m.cash || 0) + Number(m.bank || 0)))}</span>
                </div>
              ))}
              {(data.leaderboard || []).length === 0 && <div className="empty">No economy activity yet.</div>}
            </div>
          </Card>

          <Card title="Games available" sub="Casino surface" flush>
            <div className="chips">
              {(data.games || []).map((g) => (
                <Pill key={typeof g === 'string' ? g : g.key || g.id || g.name} tone="muted">{typeof g === 'string' ? g : g.name || g.key || g.id}</Pill>
              ))}
              {(data.games || []).length === 0 && <span className="small dim">Loading game registry…</span>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- members */

export function Members() {
  const members = useFetch(() => endpoints.members(), [], { poll: 25000 });
  const [selected, setSelected] = useState(null);
  const detail = useFetch(() => (selected ? endpoints.member(selected) : Promise.resolve(null)), [selected]);
  const rows = members.data?.members || [];
  const d = detail.data;

  return (
    <div className="grid split">
      <Card title="Member management" sub="Wallets, careers and net worth" flush>
        <Status loading={members.loading && !members.data} error={members.error}>
          <div className="table-wrap" style={{ maxHeight: 600 }}>
            <table>
              <thead>
                <tr><th>Member</th><th className="right">Cash</th><th className="right">Bank</th><th className="right">Net worth</th><th className="right">Level</th><th>Career</th></tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.user_id} onClick={() => setSelected(m.user_id)} style={{ cursor: 'pointer' }} className={selected === m.user_id ? 'sel' : ''}>
                    <td className="mono small">{short(m.user_id, 7, 5)}</td>
                    <td className="right mono small">{num(m.cash)}</td>
                    <td className="right mono small">{num(m.bank)}</td>
                    <td className="right mono small pos">{num(m.net_worth)}</td>
                    <td className="right small">{num(m.level)}</td>
                    <td className="small">{m.career ? `${m.career}${m.career_level ? ` · L${m.career_level}` : ''}` : '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && !members.loading && (
                  <tr><td colSpan={6}><div className="empty">No economy members yet. Run <code>/daily</code> in Discord to create a wallet.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Status>
      </Card>

      <Card
        title="Member dossier"
        sub={selected ? short(selected, 10, 6) : 'Select a member'}
        actions={selected ? <button type="button" className="btn ghost" onClick={() => setSelected(null)}>Close</button> : null}
      >
        {!selected && <div className="empty">Pick a member to inspect inventory, businesses, achievements and history.</div>}
        {selected && (
          <Status loading={detail.loading && !d} error={detail.error}>
            {d && (
              <>
                <div className="grid k3" style={{ gap: 10, marginBottom: 14 }}>
                  <Stat label="Net worth" value={num(d.netWorth?.total)} small />
                  <Stat label="Cash" value={num(d.user?.cash)} small />
                  <Stat label="Bank" value={num(d.user?.bank)} small />
                </div>
                <dl className="kv">
                  <dt>Level / XP</dt><dd>{num(d.user?.level)} · {num(d.user?.xp)} xp</dd>
                  <dt>Career</dt><dd>{d.user?.career || '—'}{d.user?.career_level ? ` · level ${d.user.career_level}` : ''}</dd>
                  <dt>Partner</dt><dd>{d.user?.married_to ? short(d.user.married_to) : 'single'}</dd>
                  <dt>Businesses</dt><dd>{(d.businesses || []).length || 'none'}</dd>
                  <dt>Inventory</dt><dd>{(d.inventory || []).length || 'empty'}</dd>
                  <dt>Achievements</dt><dd>{(d.achievements || []).length || 'none'}</dd>
                </dl>

                <div style={{ marginTop: 14 }}>
                  <div className="stat-label" style={{ marginBottom: 8 }}>Recent transactions</div>
                  {(d.transactions || []).slice(0, 8).map((t, i) => (
                    <div className="feed-row" key={i}>
                      <Pill tone={Number(t.amount) >= 0 ? 'green' : 'red'}>{Number(t.amount) >= 0 ? '+' : ''}{num(t.amount)}</Pill>
                      <span className="truncate" style={{ flex: 1 }}>{t.reason || t.kind || t.type}</span>
                      <span className="small dim nowrap">{ago(t.ts)}</span>
                    </div>
                  ))}
                  {(d.transactions || []).length === 0 && <div className="small dim">No transactions.</div>}
                </div>

                {(d.businesses || []).length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="stat-label" style={{ marginBottom: 8 }}>Business portfolio</div>
                    {d.businesses.map((b, i) => (
                      <div className="feed-row" key={i}>
                        <span className="truncate" style={{ flex: 1 }}>{b.meta?.name || b.type}</span>
                        <span className="small dim">L{b.level}</span>
                        <span className="mono small pos">{num(b.meta?.pending ?? 0)} pending</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Status>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- casino */

export function Casino() {
  const { data, error, loading } = useFetch(() => endpoints.casino(), [], { poll: 20000 });
  const stats = data?.stats || {};
  const games = stats.by_game || [];

  return (
    <>
      <div className="grid k4">
        <Stat label="Bets placed" value={num(stats.bets)} meta={`${num(stats.players)} players`} small />
        <Stat label="Wagered" value={num(stats.wagered)} meta="total handle" small />
        <Stat label="Paid out" value={num(stats.paid)} meta="winning payouts" small />
        <Stat label="House net" value={num(stats.house_net)} small tone={Number(stats.house_net) >= 0 ? 'pos' : 'neg'} meta="wagered − paid" />
      </div>

      <div className="grid split">
        <Card title="Per-game performance" sub="Handle and payout by game" flush>
          <Status loading={loading && !data} error={error}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Game</th><th className="right">Bets</th><th className="right">Wagered</th><th className="right">Paid</th><th className="right">Net</th><th>Share</th></tr></thead>
                <tbody>
                  {games.map((g) => (
                    <tr key={g.game}>
                      <td style={{ textTransform: 'capitalize' }}>{g.game}</td>
                      <td className="right mono small">{num(g.bets)}</td>
                      <td className="right mono small">{num(g.wagered)}</td>
                      <td className="right mono small">{num(g.paid)}</td>
                      <td className={`right mono small ${Number(g.wagered) - Number(g.paid) >= 0 ? 'pos' : 'neg'}`}>{num(Number(g.wagered) - Number(g.paid))}</td>
                      <td style={{ width: 120 }}><Progress value={g.bets} max={Math.max(1, ...games.map((x) => Number(x.bets) || 0))} /></td>
                    </tr>
                  ))}
                  {games.length === 0 && !loading && <tr><td colSpan={6}><div className="empty">No casino bets recorded yet.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </Status>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Biggest wins" sub="Highest payouts" flush>
            <div style={{ maxHeight: 240, overflow: 'auto' }}>
              {(stats.biggest_wins || []).map((w, i) => (
                <div className="feed-row" key={i}>
                  <span className="rank">{i + 1}</span>
                  <span className="truncate" style={{ flex: 1 }}>{short(w.user_id, 6, 4)} <span className="dim">· {w.game}</span></span>
                  <span className="mono small pos">{num(w.payout)}</span>
                  <span className="small dim nowrap">{ago(w.ts)}</span>
                </div>
              ))}
              {(stats.biggest_wins || []).length === 0 && <div className="empty">No wins recorded yet.</div>}
            </div>
          </Card>

          <Card title="Casino leaderboard" sub="Net winnings" flush>
            <div style={{ maxHeight: 240, overflow: 'auto' }}>
              {(data?.leaderboard || []).map((l, i) => (
                <div className="feed-row" key={i}>
                  <span className="rank">{i + 1}</span>
                  <span className="truncate" style={{ flex: 1 }}>{short(l.user_id || l.wallet, 6, 4)}</span>
                  <span className={`mono small ${Number(l.net ?? l.total ?? 0) >= 0 ? 'pos' : 'neg'}`}>{num(l.net ?? l.total)}</span>
                </div>
              ))}
              {(data?.leaderboard || []).length === 0 && <div className="empty">No leaderboard entries.</div>}
            </div>
          </Card>
        </div>
      </div>

      <Card title="Game registry" sub="Every game is balance-validated and atomically settled" flush>
        <div className="chips" style={{ padding: 16 }}>
          {(data?.games || []).map((g) => (
            <Pill key={typeof g === 'string' ? g : g.key || g.id} tone="green">{typeof g === 'string' ? g : g.name || g.key || g.id}</Pill>
          ))}
          {(data?.games || []).length === 0 && <span className="small dim">Registry unavailable.</span>}
        </div>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ businesses */

export function Businesses() {
  const { data, error, loading } = useFetch(() => endpoints.businesses(), [], { poll: 30000 });
  const types = data?.types || [];
  const props = data?.properties || [];

  return (
    <>
      <div className="grid split">
        <Card title="Business catalogue" sub="Purchase, upgrade and staff" flush>
          <Status loading={loading && !data} error={error}>
            <div className="table-wrap" style={{ maxHeight: 520 }}>
              <table>
                <thead><tr><th>Business</th><th className="right">Cost</th><th className="right">Base income</th><th className="right">Owned</th><th>Requirement</th></tr></thead>
                <tbody>
                  {types.map((t) => {
                    const owned = (data?.owned || []).find((o) => o.type === (t.key || t.id || t.type));
                    return (
                      <tr key={t.key || t.id || t.type || t.name}>
                        <td>
                          <div className="token-name">{t.name || t.key}</div>
                          <div className="token-sym">{t.description || t.desc || ''}</div>
                        </td>
                        <td className="right mono small">{num(t.cost ?? t.price)}</td>
                        <td className="right mono small">{num(t.income ?? t.base_income)}</td>
                        <td className="right mono small">{owned ? `${num(owned.c)} · L${num(owned.levels)}` : '—'}</td>
                        <td className="small dim">{t.requirement || t.unlock || '—'}</td>
                      </tr>
                    );
                  })}
                  {types.length === 0 && !loading && <tr><td colSpan={5}><div className="empty">Catalogue unavailable.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </Status>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Property empire" sub="Homes, garages and estates" flush>
            <div className="table-wrap" style={{ maxHeight: 260 }}>
              <table>
                <thead><tr><th>Property</th><th className="right">Price</th><th className="right">Income</th></tr></thead>
                <tbody>
                  {props.map((p) => (
                    <tr key={p.key}>
                      <td className="small">{p.name || p.key}</td>
                      <td className="right mono small">{num(p.price ?? p.cost)}</td>
                      <td className="right mono small pos">{num(p.income ?? p.rent)}</td>
                    </tr>
                  ))}
                  {props.length === 0 && <tr><td colSpan={3}><div className="empty">No properties configured.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Business leaderboard" sub="Levels across portfolios" flush>
            <div style={{ maxHeight: 240, overflow: 'auto' }}>
              {(data?.leaderboard || []).map((b, i) => (
                <div className="feed-row" key={i}>
                  <span className="rank">{i + 1}</span>
                  <span className="truncate" style={{ flex: 1 }}>{short(b.owner_id, 6, 4)}</span>
                  <span className="small dim">{num(b.businesses)} owned · L{num(b.levels)}</span>
                  <span className="mono small pos">{num(b.pending)}</span>
                </div>
              ))}
              {(data?.leaderboard || []).length === 0 && <div className="empty">No businesses founded yet.</div>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- marketplace */

export function Marketplace() {
  const [status, setStatus] = useState('open');
  const { data, error, loading } = useFetch(() => endpoints.marketplace(status), [status], { poll: 20000 });
  const listings = data?.listings || [];

  return (
    <>
      <Card
        title="Global marketplace"
        sub="Player listings, auctions and collectibles"
        actions={<Segmented options={[{ value: 'open', label: 'Open' }, { value: 'sold', label: 'Sold' }, { value: 'all', label: 'All' }]} value={status} onChange={setStatus} />}
        flush
      >
        <Status loading={loading && !data} error={error}>
          <div className="table-wrap" style={{ maxHeight: 560 }}>
            <table>
              <thead><tr><th>Item</th><th>Seller</th><th className="right">Price</th><th className="right">Qty</th><th>Status</th><th className="right">Listed</th></tr></thead>
              <tbody>
                {listings.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div className="token-name">{l.item_name || l.item || l.item_key}</div>
                      <div className="token-sym">{l.rarity || 'standard'}</div>
                    </td>
                    <td className="mono small dim">{short(l.seller_id)}</td>
                    <td className="right mono small">{num(l.price)}</td>
                    <td className="right mono small">{num(l.quantity ?? 1)}</td>
                    <td><Pill tone={l.status === 'open' ? 'green' : 'muted'}>{l.status || 'open'}</Pill></td>
                    <td className="right small dim nowrap">{ago(l.created_at)}</td>
                  </tr>
                ))}
                {listings.length === 0 && !loading && <tr><td colSpan={6}><div className="empty">No listings in this view.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </Status>
      </Card>
    </>
  );
}
