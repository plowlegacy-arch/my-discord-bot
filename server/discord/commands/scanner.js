import { SlashCommandBuilder } from 'discord.js';
import { CHAINS, chainById, explorerToken, explorerTx, liveChains } from '../../chains/registry.js';
import { indexerState, triggerScan } from '../../chains/indexer.js';
import { listTokens, feedEvents, stats, getToken, tokenEvents } from '../../services/tokens.js';
import { tokenDetail, multiplierLeaders, recentMilestoneFeed } from '../../services/tracker.js';
import { walletPnl, pnlLeaderboard, pnlOverview } from '../../services/pnl.js';
import { riskSummary, analyzeToken } from '../../services/security.js';
import { scanWallet } from '../../services/wallet.js';
import { getGuild, updateGuild } from '../../economy/store.js';
import { tokenDetailEmbed, chainStatusEmbed, walletPnlEmbed, tokenButtons } from '../embeds.js';
import { embed, ok, fail, section, block, usd, money, mult, num, pct, timeAgo, progress, DIVIDER } from '../theme.js';

const chainChoices = CHAINS.map((c) => ({ name: `${c.name}${c.status === 'live' ? ' • live' : ' • standby'}`, value: c.id }));

const chainTag = (id) => (chainById(id)?.name || id || 'chain').toUpperCase();

function resolveToken(interaction) {
  const chain = interaction.options.getString('chain');
  const address = interaction.options.getString('address');
  const id = interaction.options.getInteger('id');
  if (id) return { token: tokenDetail(id) };
  if (address && chain) {
    const t = getToken(chain, address);
    return { token: t ? tokenDetail(t.id) : null };
  }
  if (address) {
    const rows = listTokens({ search: address, limit: 5 });
    if (rows.rows.length === 1) return { token: tokenDetail(rows.rows[0].id) };
    return { token: null, ambiguous: rows.rows };
  }
  return { token: null };
}

const tokenSummary = (t) => ({
  chain: t.chain, address: t.address, symbol: t.symbol, name: t.name, price: t.price,
  market_cap: t.market_cap, liquidity_usd: t.liquidity_usd, stage: t.stage,
  baseline_price: t.baseline_price, risk_level: t.risk_level, risk_score: t.risk_score,
  created_at: t.created_at, id: t.id,
});

export const scannerCommands = [
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Full on-chain intelligence report for a token')
    .addStringOption((o) => o.setName('address').setDescription('Contract or mint address').setRequired(true))
    .addStringOption((o) => o.setName('chain').setDescription('Chain').addChoices(...chainChoices)),

  new SlashCommandBuilder()
    .setName('token')
    .setDescription('Look up a discovered token by scanner id')
    .addIntegerOption((o) => o.setName('id').setDescription('Scanner token id').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('track')
    .setDescription('Track unlimited multipliers for a token')
    .addStringOption((o) => o.setName('address').setDescription('Contract or mint address').setRequired(true))
    .addStringOption((o) => o.setName('chain').setDescription('Chain').addChoices(...chainChoices)),

  new SlashCommandBuilder()
    .setName('multipliers')
    .setDescription('Unlimited multiplier leaderboard')
    .addIntegerOption((o) => o.setName('limit').setDescription('Rows (default 10)').setMinValue(1).setMaxValue(25)),

  new SlashCommandBuilder()
    .setName('top')
    .setDescription('Highest performing tokens by recorded multiplier')
    .addStringOption((o) => o.setName('chain').setDescription('Filter by chain').addChoices(...chainChoices))
    .addStringOption((o) => o.setName('sort').setDescription('Sort order')
      .addChoices({ name: 'Multiplier', value: 'multiplier' }, { name: 'Liquidity', value: 'liquidity' }, { name: 'Market cap', value: 'marketcap' })),

  new SlashCommandBuilder()
    .setName('feed')
    .setDescription('Live discovery feed (deployments, launches, liquidity, migrations)')
    .addStringOption((o) => o.setName('type').setDescription('Event type').addChoices(
      { name: 'All events', value: 'all' },
      { name: 'Deployments', value: 'deploy' },
      { name: 'Launchpad launches', value: 'launch' },
      { name: 'First liquidity', value: 'liquidity' },
      { name: 'First trade', value: 'trade' },
      { name: 'Migrations / graduations', value: 'migrate' },
    ))
    .addStringOption((o) => o.setName('chain').setDescription('Filter by chain').addChoices(...chainChoices)),

  new SlashCommandBuilder()
    .setName('chains')
    .setDescription('Discovery pipeline status for every supported chain'),

  new SlashCommandBuilder()
    .setName('rescan')
    .setDescription('Trigger an immediate on-chain discovery pass')
    .addStringOption((o) => o.setName('chain').setDescription('Chain to scan').setRequired(true).addChoices(...chainChoices)),

  new SlashCommandBuilder()
    .setName('security')
    .setDescription('Risk analysis for a token')
    .addStringOption((o) => o.setName('address').setDescription('Contract or mint address').setRequired(true))
    .addStringOption((o) => o.setName('chain').setDescription('Chain').addChoices(...chainChoices)),

  new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Authentic wallet PNL from recorded on-chain swaps')
    .addStringOption((o) => o.setName('address').setDescription('Wallet address').setRequired(true))
    .addStringOption((o) => o.setName('chain').setDescription('Chain').setRequired(true).addChoices(...chainChoices)),

  new SlashCommandBuilder()
    .setName('pnl')
    .setDescription('Wallet PNL analytics overview')
    .addStringOption((o) => o.setName('view').setDescription('View').addChoices(
      { name: 'Overview', value: 'overview' },
      { name: 'Leaderboard', value: 'leaderboard' },
    )),

  new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Configure scanner alerts for this server')
    .addSubcommand((s) => s.setName('channel').setDescription('Set the alert channel')
      .addChannelOption((o) => o.setName('channel').setDescription('Target channel').setRequired(true)))
    .addSubcommand((s) => s.setName('filters').setDescription('Set alert thresholds')
      .addIntegerOption((o) => o.setName('min_liquidity').setDescription('Minimum liquidity in USD').setMinValue(0))
      .addIntegerOption((o) => o.setName('min_market_cap').setDescription('Minimum market cap in USD').setMinValue(0))
      .addBooleanOption((o) => o.setName('multiplier_alerts').setDescription('Post multiplier alerts')))
    .addSubcommand((s) => s.setName('status').setDescription('Show current alert configuration')),

  new SlashCommandBuilder()
    .setName('scanner')
    .setDescription('Scanner statistics and pipeline health'),
];

export async function handleScanner(interaction) {
  const name = interaction.commandName;
  const guildId = interaction.guildId || 'preview';
  const cfg = getGuild(guildId);

  if (name === 'scan' || name === 'security' || name === 'track' || name === 'token') {
    const found = resolveToken(interaction);
    if (!found.token) {
      if (found.ambiguous?.length) {
        return interaction.reply({
          embeds: [embed('discovery', {
            title: '🔍  MULTIPLE MATCHES',
            description: `${DIVIDER}\nRefine the address or pick a scanner id:\n\n${found.ambiguous
              .map((t) => `\`#${t.id}\`  **$${t.symbol || '???'}**  •  ${chainTag(t.chain)}  •  \`${t.address}\``)
              .join('\n')}\n${DIVIDER}`,
            footer: 'use /token id:<number>',
          })],
          ephemeral: true,
        });
      }
      return interaction.reply({
        embeds: [fail('TOKEN NOT FOUND', `This token has not been discovered by the on-chain pipelines yet.\n\nUse \`/rescan chain:<chain>\` to force a discovery pass, or check the address.`)],
        ephemeral: true,
      });
    }
    const t = found.token;

    if (name === 'security') {
      const report = t.risk_report || analyzeToken(t.id)?.report || null;
      return interaction.reply({
        embeds: [embed('security', {
          title: `🛡  SECURITY ANALYSIS  •  $${t.symbol || 'UNKNOWN'}  |  ${chainTag(t.chain)}`,
          description: [
            DIVIDER,
            `📊 RISK LEVEL: **${String(t.risk_level || 'PENDING').toUpperCase()}**`,
            `🎯 RISK SCORE: ${t.risk_score ?? 'n/a'}/100`,
            '',
            ...(report?.signals?.length
              ? report.signals.map((s) => `${s.severity === 'critical' ? '🔴' : s.severity === 'high' ? '🟠' : s.severity === 'medium' ? '🟡' : s.severity === 'info' ? '🟢' : '⚪'} **${s.title}** (+${s.weight}) — ${s.detail}`)
              : ['No security evidence collected yet — analysis pending.']),
            DIVIDER,
          ].join('\n'),
          fields: [
            block('CONTRACT', [`\`${t.address}\``]),
            section('CREATOR LAUNCHES', [String(t.creator_launches?.length ?? 0)]),
            section('LIQUIDITY', [t.liquidity_usd ? usd(t.liquidity_usd) : 'NOT DETECTED']),
          ],
          footer: 'signals are transparent, never a single-signal safety verdict',
        })],
      });
    }

    if (name === 'track') {
      return interaction.reply({
        embeds: [embed('multiplier', {
          title: `📈  TRACKING ARMED  •  $${t.symbol || 'UNKNOWN'}  |  ${chainTag(t.chain)}`,
          description: [
            DIVIDER,
            `🔒 BASELINE LOCKED: ${usd(t.baseline_price, 8)}`,
            `🏁 BASELINE BASIS: ${t.baseline_basis ? String(t.baseline_basis).toUpperCase() : 'FIRST OBSERVATION'}`,
            `🏆 ATH MULTIPLE: ${mult(t.ath_multiple)}`,
            `📊 CURRENT MULTIPLE: ${mult(t.multiplier)}`,
            '',
            `Milestones fire automatically with no hard-coded ceiling — from 1.01x to 100,000x and beyond.`,
            DIVIDER,
          ].join('\n'),
          fields: [block('CONTRACT', [`\`${t.address}\``])],
          footer: 'unlimited multiplier engine',
        })],
      });
    }

    const extra = {
      explorer: explorerToken(chainById(t.chain) || {}, t.address),
      explorer_tx: explorerTx(chainById(t.chain) || {}, t.deploy_tx),
    };
    const row = tokenDetailButtonsSafe(t, extra);
    return interaction.reply({ embeds: [tokenDetailEmbed(t, extra)], components: row ? [row] : [] });
  }

  if (name === 'multipliers') {
    const limit = interaction.options.getInteger('limit') || 10;
    const leaders = multiplierLeaders(limit);
    const milestones = recentMilestoneFeed(6);
    return interaction.reply({
      embeds: [embed('multiplier', {
        title: '🔥  UNLIMITED MULTIPLIERS',
        description: leaders.length
          ? [DIVIDER, ...leaders.map((t, i) => {
            const m = t.multiplier ?? (t.baseline_price > 0 && t.price > 0 ? t.price / t.baseline_price : null);
            return `**${String(i + 1).padStart(2, '0')}.**  **$${t.symbol || '???'}**  •  ${chainTag(t.chain)}\n\`${m ? mult(m) : 'no price'}\`  •  MC ${t.market_cap ? usd(t.market_cap) : 'n/a'}  •  LIQ ${t.liquidity_usd ? usd(t.liquidity_usd) : 'n/a'}`;
          }), DIVIDER].join('\n')
          : 'No priced tokens recorded yet. The engine tracks every token from its first observation.',
        fields: milestones.length
          ? [block('RECENT MILESTONES', milestones.map((m) => `${m.symbol ? `$${m.symbol}` : `#${m.token_id}`} → **${mult(m.multiple)}** (${m.basis})`))]
          : [],
        footer: 'no hard-coded maximum multiple',
      })],
    });
  }

  if (name === 'top') {
    const chain = interaction.options.getString('chain') || undefined;
    const sort = interaction.options.getString('sort') || 'multiplier';
    const { rows } = listTokens({ chain, limit: 10, sort, minLiquidity: 0 });
    return interaction.reply({
      embeds: [embed('discovery', {
        title: `📊  TOP TOKENS${chain ? `  •  ${chainTag(chain)}` : ''}`,
        description: rows.length
          ? [DIVIDER, ...rows.map((t, i) => {
            const m = t.baseline_price > 0 && t.price > 0 ? t.price / t.baseline_price : null;
            return `**${String(i + 1).padStart(2, '0')}.**  **$${t.symbol || '???'}**  •  ${chainTag(t.chain)}\n\`${m ? mult(m) : 'n/a'}\`  •  ${t.market_cap ? usd(t.market_cap) : 'no mcap'}  •  ${t.stage ? String(t.stage).toUpperCase() : 'DEPLOYED'}`;
          }), DIVIDER].join('\n')
          : 'No tokens recorded for this filter yet.',
        footer: `sorted by ${sort}`,
      })],
    });
  }

  if (name === 'feed') {
    const type = interaction.options.getString('type') || 'all';
    const chain = interaction.options.getString('chain') || undefined;
    const events = feedEvents({ type: type === 'all' ? undefined : type, chain, limit: 12 });
    return interaction.reply({
      embeds: [embed('discovery', {
        title: `📡  LIVE DISCOVERY FEED  •  ${type === 'all' ? 'ALL EVENTS' : type.toUpperCase()}`,
        description: events.length
          ? [DIVIDER, ...events.map((ev) => {
            const label = String(ev.type || ev.kind || 'event').toUpperCase();
            const sym = ev.symbol ? `$${ev.symbol}` : `#${ev.token_id}`;
            return `**${label}**  •  ${sym}  •  ${chainTag(ev.chain)}\n\`${String(ev.address || '').slice(0, 20)}…\`  •  ${timeAgo(ev.ts)}`;
          }), DIVIDER].join('\n')
          : 'No events recorded yet. Start the indexer or run `/rescan` on a live chain.',
        footer: 'deployment • mint • launch • liquidity • trade • migration',
      })],
    });
  }

  if (name === 'chains') {
    const rows = indexerState();
    return interaction.reply({ embeds: [chainStatusEmbed(rows)] });
  }

  if (name === 'rescan') {
    const chainId = interaction.options.getString('chain');
    await interaction.deferReply();
    try {
      const result = await triggerScan(chainId);
      return interaction.editReply({
        embeds: [ok('discovery', `SCAN COMPLETE  •  ${chainTag(chainId)}`, [
          DIVIDER,
          `🔎 TOKENS DISCOVERED: **${result?.discovered ?? 0}**`,
          `🧱 BLOCKS COVERED: ${result?.blocks ?? 0}`,
          `💧 POOLS TOUCHED: ${result?.pools ?? 0}`,
          `⏱ DURATION: ${result?.ms ? `${result.ms} ms` : 'n/a'}`,
          DIVIDER,
        ].join('\n'), { footer: 'on-chain RPC discovery, no screener listings' })],
      });
    } catch (err) {
      return interaction.editReply({ embeds: [fail('SCAN FAILED', `\`${err.message}\``)] });
    }
  }

  if (name === 'wallet') {
    const address = interaction.options.getString('address');
    const chain = interaction.options.getString('chain');
    await interaction.deferReply();
    try {
      await scanWallet(null, chain, address).catch(() => null);
      const pnl = walletPnl(chain, address);
      return interaction.editReply({ embeds: [walletPnlEmbed(pnl)] });
    } catch (err) {
      return interaction.editReply({ embeds: [fail('PNL UNAVAILABLE', `\`${err.message}\``)] });
    }
  }

  if (name === 'pnl') {
    const view = interaction.options.getString('view') || 'overview';
    if (view === 'leaderboard') {
      const rows = pnlLeaderboard(12);
      return interaction.reply({
        embeds: [embed('pnl', {
          title: '🏆  WALLET PNL LEADERBOARD',
          description: rows.length
            ? [DIVIDER, ...rows.map((w, i) => `**${String(i + 1).padStart(2, '0')}.**  \`${String(w.wallet).slice(0, 10)}…\`  •  ${chainTag(w.chain)}\n\`${w.total_pnl >= 0 ? '+' : ''}${usd(w.total_pnl)}\`  •  win ${w.win_rate != null ? pct(w.win_rate * 100) : 'n/a'}  •  trades ${w.trades ?? 0}`), DIVIDER].join('\n')
            : 'No wallet PNL recorded yet. Swap activity is indexed from on-chain trades only.',
          footer: 'authentic PNL — no fabricated profits',
        })],
      });
    }
    const o = pnlOverview();
    return interaction.reply({
      embeds: [embed('pnl', {
        title: '📊  PNL ANALYTICS OVERVIEW',
        description: [
          DIVIDER,
          `👛 TRACKED WALLETS: **${num(o.wallets ?? 0)}**`,
          `🔄 RECORDED SWAPS: **${num(o.trades ?? 0)}**`,
          `💵 REALIZED PNL: **${usd(o.realized ?? 0)}**`,
          `📈 UNREALIZED PNL: **${usd(o.unrealized ?? 0)}**`,
          `📊 WIN RATE: ${o.win_rate != null ? pct(o.win_rate * 100) : 'n/a'}`,
          DIVIDER,
        ].join('\n'),
        footer: 'average-cost positions from recorded swaps',
      })],
    });
  }

  if (name === 'alerts') {
    const sub = interaction.getSubcommand();
    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      updateGuild(guildId, { alert_channel: channel.id });
      return interaction.reply({
        embeds: [ok('discovery', 'ALERT CHANNEL UPDATED', `${DIVIDER}\nNew deployments, liquidity events and multiplier alerts will post in <#${channel.id}>.\n${DIVIDER}`)],
        ephemeral: true,
      });
    }
    if (sub === 'filters') {
      const patch = {};
      const liq = interaction.options.getInteger('min_liquidity');
      const mc = interaction.options.getInteger('min_market_cap');
      const multAlerts = interaction.options.getBoolean('multiplier_alerts');
      if (liq != null) patch.min_alert_liquidity = liq;
      if (mc != null) patch.min_alert_marketcap = mc;
      if (multAlerts != null) patch.multiplier_alerts = multAlerts ? 1 : 0;
      updateGuild(guildId, patch);
      return interaction.reply({ embeds: [ok('discovery', 'ALERT FILTERS SAVED', `${DIVIDER}\n\`\`\`\n${JSON.stringify(patch, null, 2)}\n\`\`\`\n${DIVIDER}`)], ephemeral: true });
    }
    return interaction.reply({
      embeds: [embed('discovery', {
        title: '🔔  ALERT CONFIGURATION',
        description: [
          DIVIDER,
          `📢 CHANNEL: ${cfg.alert_channel ? `<#${cfg.alert_channel}>` : 'not set'}`,
          `💧 MIN LIQUIDITY: ${cfg.min_alert_liquidity ? usd(cfg.min_alert_liquidity) : 'any'}`,
          `📊 MIN MARKET CAP: ${cfg.min_alert_marketcap ? usd(cfg.min_alert_marketcap) : 'any'}`,
          `🔥 MULTIPLIER ALERTS: ${cfg.multiplier_alerts ? 'enabled' : 'disabled'}`,
          `⛓ TRACKED CHAINS: ${cfg.tracked_chains || 'all live chains'}`,
          DIVIDER,
        ].join('\n'),
        footer: 'alerts are delivered from the on-chain pipeline',
      })],
      ephemeral: true,
    });
  }

  if (name === 'scanner') {
    const s = stats();
    const risk = riskSummary();
    const live = liveChains();
    return interaction.reply({
      embeds: [embed('discovery', {
        title: '🛰  TRENCH SCANNER  •  PIPELINE STATUS',
        description: [
          DIVIDER,
          `⛓ LIVE CHAINS: **${live.length}/${CHAINS.length}**`,
          `🪙 TOKENS TRACKED: **${num(s.tokens ?? 0)}**`,
          `🆕 DEPLOYMENTS: **${num(s.deployments ?? 0)}**`,
          `🚀 LAUNCHES: **${num(s.launches ?? 0)}**`,
          `💧 LIQUID POOLS: **${num(s.liquidity ?? 0)}**`,
          `🔥 MILESTONES HIT: **${num(s.milestones ?? 0)}**`,
          '',
          `🛡 RISK — critical ${risk.critical ?? 0} • high ${risk.high ?? 0} • medium ${risk.medium ?? 0} • low ${risk.low ?? 0}`,
          DIVIDER,
        ].join('\n'),
        fields: [block('LIVE CHAINS', [live.map((c) => c.name).join(' • ') || 'none — configure RPC endpoints'])],
        footer: 'direct RPC discovery • persistent cursors • reorg handling',
      })],
    });
  }

  return null;
}

function tokenDetailButtonsSafe(t, extra) {
  try {
    return tokenButtons({ ...t, explorer_tx: extra.explorer_tx });
  } catch {
    return null;
  }
}

export const scannerCommandNames = scannerCommands.map((c) => c.name);
