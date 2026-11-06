import {
  Client, GatewayIntentBits, Partials, Events, REST, Routes, MessageFlags,
} from 'discord.js';
import { db, now } from '../db.js';
import { getGuild, updateGuild } from '../economy/store.js';
import { economyCommands } from './commands/economy.js';
import { casinoCommands } from './commands/casino.js';
import { worldCommands } from './commands/world.js';
import { adminCommands } from './commands/admin.js';
import { scannerCommands, handleScanner } from './commands/scanner.js';
import { tokenEventEmbed, multiplierEmbed, tokenDetailEmbed, tokenButtons, multiplierButtons } from './embeds.js';
import { embed, fail, ok, DIVIDER, mult, usd, num } from './theme.js';
import { bus } from '../services/tracker.js';
import { tokenDetail } from '../services/tracker.js';
import { tokenWallets as walletsOfToken } from '../services/pnl.js';
import { dueGiveaways, drawGiveaway, getGiveaway } from '../economy/giveaways.js';
import { currentLotteryRound, drawLottery } from '../economy/casino.js';
import { trackWalletActivity } from '../services/wallet.js';

const MAPS = [economyCommands, casinoCommands, worldCommands, adminCommands];
const commandIndex = new Map();
for (const map of MAPS) {
  for (const [name, entry] of Object.entries(map)) commandIndex.set(name, entry);
}

const state = {
  running: false,
  ready: false,
  tag: null,
  guilds: 0,
  commands: 0,
  alerts_sent: 0,
  giveaways_drawn: 0,
  last_error: null,
  started_at: null,
};

export function botState() {
  return {
    enabled: Boolean(process.env.DISCORD_TOKEN),
    running: state.running,
    ready: state.ready,
    tag: state.tag,
    guilds: state.guilds,
    commands: state.commands,
    alerts_sent: state.alerts_sent,
    giveaways_drawn: state.giveaways_drawn,
    started_at: state.started_at,
    uptime_s: state.started_at ? Math.round((Date.now() - state.started_at) / 1000) : 0,
    last_error: state.last_error,
  };
}

/* -------------------------------------------------------------- slash data */

function commandPayloads() {
  const out = [];
  for (const entry of commandIndex.values()) out.push(entry.data.toJSON());
  for (const builder of scannerCommands) out.push(builder.toJSON());
  return out;
}

async function registerCommands(client) {
  const payload = commandPayloads();
  state.commands = payload.length;
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const appId = process.env.DISCORD_CLIENT_ID || client.user.id;
  const guildId = process.env.DEFAULT_GUILD_ID;

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: payload });
    console.log(`[discord] registered ${payload.length} guild commands in ${guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(appId), { body: payload });
    console.log(`[discord] registered ${payload.length} global commands`);
  }
}

/* ----------------------------------------------------------------- alerts */

const ALERT_EVENTS = new Set(['deploy', 'mint', 'launch', 'liquidity', 'trade', 'migrate', 'graduation']);
const recentAlerts = new Map();
const ALERT_WINDOW_MS = 8 * 1000;

function alertChannels(client) {
  const rows = db.prepare('SELECT * FROM guilds').all();
  const out = [];
  for (const g of rows) {
    if (!g.alert_channel) continue;
    const channel = client.channels.cache.get(String(g.alert_channel));
    if (channel?.isTextBased?.()) out.push({ config: g, channel });
  }
  return out;
}

function throttled(key) {
  const ts = recentAlerts.get(key) || 0;
  if (Date.now() - ts < ALERT_WINDOW_MS) return true;
  recentAlerts.set(key, Date.now());
  if (recentAlerts.size > 500) {
    const cutoff = Date.now() - 60_000;
    for (const [k, v] of recentAlerts) if (v < cutoff) recentAlerts.delete(k);
  }
  return false;
}

async function publish(client, embedBuilder, key) {
  if (throttled(key)) return;
  for (const { config, channel } of alertChannels(client)) {
    try {
      await channel.send({ embeds: [embedBuilder] });
      state.alerts_sent += 1;
    } catch (err) {
      state.last_error = `alert: ${err.message}`;
    }
  }
}

function wireAlerts(client) {
  bus.on('event', async (payload) => {
    try {
      const type = String(payload.type || payload.kind || '').toLowerCase();
      if (!ALERT_EVENTS.has(type)) return;
      const token = payload.token || payload;
      if (!token?.address) return;
      if (token.liquidity_usd && token.liquidity_usd < 0) return;
      await publish(client, tokenEventEmbed(token, type), `evt:${type}:${token.chain}:${token.address}`);
    } catch (err) {
      state.last_error = `event alert: ${err.message}`;
    }
  });

  bus.on('milestone', async (payload) => {
    try {
      const token = payload.token || tokenDetail(payload.token_id);
      if (!token) return;
      await publish(
        client,
        multiplierEmbed({ token, multiple: payload.multiple, basis: payload.basis || 'price' }),
        `ms:${payload.token_id}:${payload.basis || 'price'}:${payload.multiple}`,
      );
    } catch (err) {
      state.last_error = `milestone alert: ${err.message}`;
    }
  });
}

/* -------------------------------------------------------------- schedulers */

async function drawDueGiveaways(client) {
  let due = [];
  try {
    due = dueGiveaways();
  } catch (err) {
    state.last_error = `giveaway scan: ${err.message}`;
    return;
  }
  for (const row of due) {
    try {
      const result = drawGiveaway(row.guild_id, row.id);
      if (!result?.ok) continue;
      state.giveaways_drawn += 1;
      const g = getGiveaway(row.guild_id, row.id);
      const channel = g?.channel_id ? client.channels.cache.get(String(g.channel_id)) : null;
      if (!channel?.isTextBased?.()) continue;
      const winners = result.winners || [];
      await channel.send({
        embeds: [embed('giveaway', {
          title: '🎉  GIVEAWAY ENDED',
          description: [
            DIVIDER,
            `🎁 PRIZE: **${result.prize}**`,
            `👑 WINNER${winners.length === 1 ? '' : 'S'}: ${winners.length ? winners.map((w) => `<@${w}>`).join(' • ') : 'no valid entries'}`,
            DIVIDER,
          ].join('\n'),
          footer: `giveaway #${g?.id ?? row.id}`,
        })],
      });
    } catch (err) {
      state.last_error = `giveaway draw: ${err.message}`;
    }
  }
}

async function drawDueLotteries(client) {
  const rows = db.prepare("SELECT DISTINCT guild_id FROM lottery_rounds WHERE status = 'open'").all();
  for (const row of rows) {
    try {
      const round = currentLotteryRound(row.guild_id);
      if (!round?.ends_at || round.ends_at > now()) continue;
      const result = drawLottery(row.guild_id);
      if (!result?.ok) continue;
      const cfg = getGuild(row.guild_id);
      const channel = cfg.alert_channel ? client.channels.cache.get(String(cfg.alert_channel)) : null;
      if (!channel?.isTextBased?.()) continue;
      await channel.send({
        embeds: [embed('casino', {
          title: '🎟  LOTTERY DRAWN',
          description: [DIVIDER, `🏆 WINNER: <@${result.winner}>`, `💰 PAYOUT: **${num(result.payout)}**`, DIVIDER].join('\n'),
          footer: `round #${result.round}`,
        })],
      });
    } catch (err) {
      state.last_error = `lottery draw: ${err.message}`;
    }
  }
}

async function walletTrackingLoop() {
  try {
    await trackWalletActivity();
  } catch (err) {
    state.last_error = `wallet tracking: ${err.message}`;
  }
}

/* ----------------------------------------------------------------- router */

function flags(ephemeral) {
  return ephemeral ? MessageFlags.Ephemeral : undefined;
}

async function safeReply(i, payload) {
  if (!payload) return;
  const body = {
    embeds: payload.embeds || [],
    components: payload.components || [],
    ephemeral: payload.ephemeral,
  };
  if (i.replied || i.deferred) {
    if (body.embeds.length || body.components.length) await i.followUp(body).catch(() => null);
    return;
  }
  await i.reply(body).catch(async (err) => {
    state.last_error = `reply: ${err.message}`;
  });
}

async function handleChatInput(i) {
  const name = i.commandName;
  try {
    const scannerName = scannerCommands.some((b) => b.name === name);
    if (scannerName) {
      await handleScanner(i);
      return;
    }
    const entry = commandIndex.get(name);
    if (!entry) {
      await safeReply(i, { embeds: [fail('UNKNOWN COMMAND', `\`/${name}\` is not wired up yet.`)], ephemeral: true });
      return;
    }
    const result = await entry.run({ guildId: i.guildId || 'preview', userId: i.user.id, i, client: i.client });
    await safeReply(i, result);
  } catch (err) {
    console.error('[discord]', name, err);
    state.last_error = `${name}: ${err.message}`;
    await safeReply(i, {
      embeds: [fail('COMMAND ERROR', `\`${err.message || 'unexpected error'}\`\n\nNothing was charged. Try again in a moment.`)],
      ephemeral: true,
    });
  }
}

async function handleAutocomplete(i) {
  const entry = commandIndex.get(i.commandName);
  if (!entry?.autocomplete) {
    await i.respond([]).catch(() => null);
    return;
  }
  try {
    await entry.autocomplete(i);
  } catch (err) {
    state.last_error = `autocomplete ${i.commandName}: ${err.message}`;
    await i.respond([]).catch(() => null);
  }
}

async function handleButton(i) {
  const [action, rawId] = i.customId.split(':');
  const id = Number(rawId);
  try {
    if (action === 'scan') {
      const t = tokenDetail(id);
      if (!t) return i.reply({ embeds: [fail('TOKEN MISSING', 'This token is no longer in the index.')], ephemeral: true });
      return i.reply({ embeds: [tokenDetailEmbed(t)], components: [tokenButtons(t)] });
    }
    if (action === 'track') {
      const t = tokenDetail(id);
      if (!t) return i.reply({ embeds: [fail('TOKEN MISSING', 'This token is no longer in the index.')], ephemeral: true });
      return i.reply({
        embeds: [embed('multiplier', {
          title: `📈  TRACKING  •  $${t.symbol || 'UNKNOWN'}  |  ${String(t.chain).toUpperCase()}`,
          description: [
            DIVIDER,
            `🔒 BASELINE: ${usd(t.baseline_price, 8)} (${String(t.baseline_basis || 'first observation').toUpperCase()})`,
            `📊 CURRENT: ${usd(t.price, 8)}`,
            `🔥 MULTIPLE: **${mult(t.multiplier)}**`,
            `🏆 ATH: ${mult(t.ath_multiple)}`,
            `💧 LIQUIDITY: ${t.liquidity_usd ? usd(t.liquidity_usd) : 'NOT DETECTED'}`,
            DIVIDER,
          ].join('\n'),
          footer: 'unlimited multiplier engine',
        })],
        components: [multiplierButtons(t)],
      });
    }
    if (action === 'pnl') {
      const t = tokenDetail(id);
      if (!t) return i.reply({ embeds: [fail('TOKEN MISSING', 'This token is no longer in the index.')], ephemeral: true });
      const wallets = walletsOfToken(t.chain, t.address, 10);
      return i.reply({
        embeds: [embed('pnl', {
          title: `💹  TOKEN WALLET PNL  •  $${t.symbol || 'UNKNOWN'}`,
          description: wallets.length
            ? [DIVIDER, ...wallets.map((w) => `\`${String(w.wallet).slice(0, 10)}…\`  •  ${w.total_pnl >= 0 ? '+' : ''}${usd(w.total_pnl)}  •  bought ${usd(w.bought_usd)}  •  sold ${usd(w.sold_usd)}`), DIVIDER].join('\n')
            : 'No recorded swap activity for this token yet.',
          footer: 'recorded on-chain swaps only',
        })],
      });
    }
    return i.reply({ embeds: [fail('UNKNOWN ACTION', 'This control is out of date.')], ephemeral: true });
  } catch (err) {
    state.last_error = `button ${i.customId}: ${err.message}`;
    if (!i.replied && !i.deferred) {
      await i.reply({ embeds: [fail('ACTION FAILED', `\`${err.message}\``)], ephemeral: true }).catch(() => null);
    }
  }
}

/* ------------------------------------------------------------------- start */

let client = null;
let timers = [];

export async function startBot() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    state.last_error = 'DISCORD_TOKEN not configured';
    console.warn('[discord] DISCORD_TOKEN missing — bot disabled, dashboard/API still running');
    return null;
  }
  if (state.running) return client;

  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, async () => {
    state.ready = true;
    state.running = true;
    state.tag = client.user.tag;
    state.guilds = client.guilds.cache.size;
    state.started_at = Date.now();
    console.log(`[discord] logged in as ${state.tag} (${state.guilds} guilds)`);
    try {
      await registerCommands(client);
    } catch (err) {
      state.last_error = `command registration: ${err.message}`;
      console.warn('[discord] command registration failed:', err.message);
    }
    wireAlerts(client);

    timers.push(setInterval(() => drawDueGiveaways(client), 20_000));
    timers.push(setInterval(() => drawDueLotteries(client), 60_000));
    timers.push(setInterval(() => walletTrackingLoop(), 90_000));
    for (const t of timers) t.unref?.();
  });

  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isChatInputCommand()) return await handleChatInput(i);
      if (i.isAutocomplete()) return await handleAutocomplete(i);
      if (i.isButton()) return await handleButton(i);
      return null;
    } catch (err) {
      state.last_error = `interaction: ${err.message}`;
      return null;
    }
  });

  client.on(Events.GuildCreate, (g) => {
    state.guilds = client.guilds.cache.size;
    try {
      updateGuild(g.id, {});
    } catch (err) {
      state.last_error = `guild init: ${err.message}`;
    }
  });

  client.on(Events.Error, (err) => {
    state.last_error = `client: ${err.message}`;
  });

  await client.login(token).catch((err) => {
    state.last_error = `login: ${err.message}`;
    state.running = false;
    throw err;
  });

  return client;
}

export function stopBot() {
  for (const t of timers) clearInterval(t);
  timers = [];
  if (client) client.destroy();
  state.running = false;
  state.ready = false;
}

export { commandPayloads };
