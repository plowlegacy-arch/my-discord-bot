import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { db, now } from '../../db.js';
import {
  getGuild, getUser, updateGuild, credit, debit, setBalance, resetBalance, audit, auditLog,
  leaderboard, netWorth,
} from '../../economy/store.js';
import { addItem, removeItem, inventory } from '../../economy/marketplace.js';
import { itemByKey, ITEMS } from '../../economy/items.js';
import { CHAINS } from '../../chains/registry.js';
import { embed, fail, money, num, ok, progress, section, timeAgo, errorText, ICON, duration } from '../theme.js';

// Administrative surface. Minting never touches the actor's balance: authorized
// staff can create currency from nothing, exactly like a server treasury.

const parseRoles = (json) => {
  try { return JSON.parse(json || '[]'); } catch { return []; }
};

export function isAuthorized(interaction, { ownerOnly = false } = {}) {
  const member = interaction.member;
  if (!member) return false;
  const guildId = interaction.guildId;
  const cfg = getGuild(guildId);
  const isOwner = interaction.guild?.ownerId === interaction.user.id
    || parseRoles(cfg.owner_role_ids).some((r) => member.roles?.cache?.has?.(r))
    || member.permissions?.has?.(PermissionFlagsBits.Administrator);
  if (isOwner) return true;
  if (ownerOnly) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  return parseRoles(cfg.admin_role_ids).some((r) => member.roles?.cache?.has?.(r));
}

const denied = () => ({ embeds: [fail('NOT AUTHORIZED', 'This command is restricted to the server owner and configured economy administrators.\n\nUse `/economysettings roles` to authorize a role.')] });

const targetOf = (i) => i.options.getUser('member') || i.user;

export const adminCommands = {
  addmoney: {
    data: new SlashCommandBuilder().setName('addmoney').setDescription('[ADMIN] Mint currency into a wallet')
      .addUserOption((o) => o.setName('member').setDescription('Recipient').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount to mint').setRequired(true).setMinValue(1)),
    async run({ guildId, userId, i }) {
      if (!isAuthorized(i)) return denied();
      const target = targetOf(i);
      const amount = i.options.getInteger('amount');
      const res = credit(guildId, target.id, amount, 'admin_mint', { actor: userId });
      audit(guildId, userId, 'addmoney', target.id, amount);
      return {
        embeds: [ok('admin', 'CURRENCY MINTED', [
          `MINTED: **${money(amount, getGuild(guildId).currency_symbol)}**`,
          `RECIPIENT: <@${target.id}>`,
          `NEW WALLET: **${money(res.cash, getGuild(guildId).currency_symbol)}**`,
          '',
          `Logged to the audit trail by <@${userId}>.`,
        ].join('\n'))],
      };
    },
  },

  removemoney: {
    data: new SlashCommandBuilder().setName('removemoney').setDescription('[ADMIN] Remove currency from a wallet')
      .addUserOption((o) => o.setName('member').setDescription('Target').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
    async run({ guildId, userId, i }) {
      if (!isAuthorized(i)) return denied();
      const target = targetOf(i);
      const amount = i.options.getInteger('amount');
      const res = debit(guildId, target.id, amount, 'admin_remove', { actor: userId, allowNegative: false });
      audit(guildId, userId, 'removemoney', target.id, amount);
      if (!res.ok) return { embeds: [fail('REMOVAL FAILED', 'The member does not hold that much cash. Use `/setbalance` for an exact value.')] };
      return { embeds: [ok('admin', 'CURRENCY REMOVED', `REMOVED: **${money(amount)}** from <@${target.id}>\nWALLET: **${money(res.cash)}**`)] };
    },
  },

  setbalance: {
    data: new SlashCommandBuilder().setName('setbalance').setDescription('[ADMIN] Set a wallet to an exact value')
      .addUserOption((o) => o.setName('member').setDescription('Target').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Exact cash value').setRequired(true).setMinValue(0)),
    async run({ guildId, userId, i }) {
      if (!isAuthorized(i)) return denied();
      const target = targetOf(i);
      const amount = i.options.getInteger('amount');
      const row = setBalance(guildId, target.id, 'cash', amount);
      audit(guildId, userId, 'setbalance', target.id, amount);
      return { embeds: [ok('admin', 'BALANCE SET', `WALLET for <@${target.id}> is now **${money(row.cash)}**.`)] };
    },
  },

  addbank: {
    data: new SlashCommandBuilder().setName('addbank').setDescription('[ADMIN] Mint currency into a bank account')
      .addUserOption((o) => o.setName('member').setDescription('Target').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
    async run({ guildId, userId, i }) {
      if (!isAuthorized(i)) return denied();
      const target = targetOf(i);
      const amount = i.options.getInteger('amount');
      const u = getUser(guildId, target.id);
      const row = setBalance(guildId, target.id, 'bank', u.bank + amount);
      audit(guildId, userId, 'addbank', target.id, amount);
      return { embeds: [ok('admin', 'BANK CREDITED', `BANK for <@${target.id}> is now **${money(row.bank)}**.`)] };
    },
  },

  setbank: {
    data: new SlashCommandBuilder().setName('setbank').setDescription('[ADMIN] Set a bank balance exactly')
      .addUserOption((o) => o.setName('member').setDescription('Target').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Exact bank value').setRequired(true).setMinValue(0)),
    async run({ guildId, userId, i }) {
      if (!isAuthorized(i)) return denied();
      const target = targetOf(i);
      const amount = i.options.getInteger('amount');
      const row = setBalance(guildId, target.id, 'bank', amount);
      audit(guildId, userId, 'setbank', target.id, amount);
      return { embeds: [ok('admin', 'BANK SET', `BANK for <@${target.id}> is now **${money(row.bank)}**.`)] };
    },
  },

  resetbalance: {
    data: new SlashCommandBuilder().setName('resetbalance').setDescription('[ADMIN] Reset a member to the starting balance')
      .addUserOption((o) => o.setName('member').setDescription('Target').setRequired(true)),
    async run({ guildId, userId, i }) {
      if (!isAuthorized(i)) return denied();
      const target = targetOf(i);
      const row = resetBalance(guildId, target.id);
      audit(guildId, userId, 'resetbalance', target.id, row.cash);
      return { embeds: [ok('admin', 'BALANCE RESET', `<@${target.id}> now holds **${money(row.cash)}** cash and an empty bank.`)] };
    },
  },

  additem: {
    data: new SlashCommandBuilder().setName('additem').setDescription('[ADMIN] Grant an item')
      .addUserOption((o) => o.setName('member').setDescription('Recipient').setRequired(true))
      .addStringOption((o) => o.setName('item').setDescription('Item key').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('qty').setDescription('Quantity').setMinValue(1).setMaxValue(1000)),
    async autocomplete(i) {
      const q = i.options.getFocused().toLowerCase();
      return i.respond(Object.keys(ITEMS).filter((k) => k.includes(q)).slice(0, 25)
        .map((k) => ({ name: `${ITEMS[k].emoji} ${ITEMS[k].name}`, value: k })));
    },
    async run({ guildId, userId, i }) {
      if (!isAuthorized(i)) return denied();
      const target = targetOf(i);
      const key = i.options.getString('item');
      const qty = i.options.getInteger('qty') || 1;
      addItem(guildId, target.id, key, qty);
      audit(guildId, userId, 'additem', target.id, qty, { item: key });
      const it = itemByKey(key);
      return { embeds: [ok('admin', 'ITEM GRANTED', `Gave ${it?.emoji || '📦'} **${it?.name || key}** x${qty} to <@${target.id}>.`)] };
    },
  },

  removeitem: {
    data: new SlashCommandBuilder().setName('removeitem').setDescription('[ADMIN] Remove an item')
      .addUserOption((o) => o.setName('member').setDescription('Target').setRequired(true))
      .addStringOption((o) => o.setName('item').setDescription('Item key').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('qty').setDescription('Quantity').setMinValue(1).setMaxValue(1000)),
    async autocomplete(i) {
      const q = i.options.getFocused().toLowerCase();
      return i.respond(inventory(i.guildId, i.user.id).filter((r) => r.item_key.includes(q)).slice(0, 25)
        .map((r) => ({ name: `${ITEMS[r.item_key]?.name || r.item_key} (x${r.qty})`, value: r.item_key })));
    },
    async run({ guildId, userId, i }) {
      if (!isAuthorized(i)) return denied();
      const target = targetOf(i);
      const key = i.options.getString('item');
      const qty = i.options.getInteger('qty') || 1;
      const okRemoved = removeItem(guildId, target.id, key, qty);
      if (!okRemoved) return { embeds: [fail('REMOVAL FAILED', 'That member does not hold that many.')] };
      audit(guildId, userId, 'removeitem', target.id, qty, { item: key });
      return { embeds: [ok('admin', 'ITEM REMOVED', `Removed **${key}** x${qty} from <@${target.id}>.`)] };
    },
  },

  setcurrency: {
    data: new SlashCommandBuilder().setName('setcurrency').setDescription('[ADMIN] Customize the server currency')
      .addStringOption((o) => o.setName('name').setDescription('Currency name'))
      .addStringOption((o) => o.setName('symbol').setDescription('Currency symbol or emoji'))
      .addIntegerOption((o) => o.setName('daily').setDescription('Daily reward'))
      .addIntegerOption((o) => o.setName('weekly').setDescription('Weekly reward'))
      .addIntegerOption((o) => o.setName('monthly').setDescription('Monthly reward'))
      .addIntegerOption((o) => o.setName('starting').setDescription('Starting balance for new members'))
      .addIntegerOption((o) => o.setName('min_bet').setDescription('Minimum bet'))
      .addIntegerOption((o) => o.setName('max_bet').setDescription('Maximum bet')),
    async run({ guildId, userId, i }) {
      if (!isAuthorized(i, { ownerOnly: true })) return denied();
      const patch = {};
      if (i.options.getString('name')) patch.currency_name = i.options.getString('name');
      if (i.options.getString('symbol')) patch.currency_symbol = i.options.getString('symbol');
      for (const [opt, col] of [['daily', 'daily_amount'], ['weekly', 'weekly_amount'], ['monthly', 'monthly_amount'],
        ['starting', 'starting_balance'], ['min_bet', 'min_bet'], ['max_bet', 'max_bet']]) {
        const v = i.options.getInteger(opt);
        if (v != null) patch[col] = v;
      }
      if (!Object.keys(patch).length) return { embeds: [fail('NO CHANGES', 'Provide at least one setting.')] };
      const cfg = updateGuild(guildId, patch);
      audit(guildId, userId, 'setcurrency', null, null, patch);
      return {
        embeds: [embed('admin', {
          title: '⚙️  CURRENCY UPDATED',
          description: section('CURRENT CONFIGURATION', [
            `NAME: **${cfg.currency_name}**`,
            `SYMBOL: **${cfg.currency_symbol}**`,
            `DAILY / WEEKLY / MONTHLY: ${num(cfg.daily_amount)} / ${num(cfg.weekly_amount)} / ${num(cfg.monthly_amount)}`,
            `STARTING: ${num(cfg.starting_balance)}`,
            `BETS: ${num(cfg.min_bet)} — ${num(cfg.max_bet)}`,
          ]).value,
          footer: `updated by ${i.user.username}`,
        })],
      };
    },
  },

  economysettings: {
    data: new SlashCommandBuilder().setName('economysettings').setDescription('[ADMIN] View and configure economy settings')
      .addSubcommand((s) => s.setName('show').setDescription('Show current settings'))
      .addSubcommand((s) => s.setName('roles').setDescription('Authorize economy administrator roles')
        .addStringOption((o) => o.setName('admin_role').setDescription('Role id to authorize'))
        .addStringOption((o) => o.setName('owner_role').setDescription('Role id with owner-level access'))
        .addBooleanOption((o) => o.setName('clear').setDescription('Clear configured roles')))
      .addSubcommand((s) => s.setName('alerts').setDescription('Configure scanner alert routing')
        .addChannelOption((o) => o.setName('channel').setDescription('Alert channel'))
        .addIntegerOption((o) => o.setName('min_liquidity').setDescription('Minimum liquidity in USD'))
        .addIntegerOption((o) => o.setName('min_marketcap').setDescription('Minimum market cap in USD'))
        .addBooleanOption((o) => o.setName('multiplier_alerts').setDescription('Enable multiplier alerts'))
        .addStringOption((o) => o.setName('chains').setDescription('Comma separated chain ids to watch')))
      .addSubcommand((s) => s.setName('audit').setDescription('Recent administrative actions')),
    async run({ guildId, userId, i }) {
      const sub = i.options.getSubcommand();
      if (!isAuthorized(i)) return denied();
      if (sub === 'roles') {
        const patch = {};
        if (i.options.getBoolean('clear')) patch.admin_role_ids = [];
        const admin = i.options.getString('admin_role');
        const owner = i.options.getString('owner_role');
        if (admin) patch.admin_role_ids = [...new Set([...parseRoles(getGuild(guildId).admin_role_ids), admin])];
        if (owner) patch.owner_role_ids = [...new Set([...parseRoles(getGuild(guildId).owner_role_ids), owner])];
        if (!Object.keys(patch).length) return { embeds: [fail('NO CHANGES', 'Specify a role to authorize or clear.')] };
        const cfg = updateGuild(guildId, patch);
        audit(guildId, userId, 'roles_updated', null, null, patch);
        return {
          embeds: [ok('admin', 'PERMISSIONS UPDATED', [
            `ADMIN ROLES: ${parseRoles(cfg.admin_role_ids).map((r) => `<@&${r}>`).join(', ') || '—'}`,
            `OWNER ROLES: ${parseRoles(cfg.owner_role_ids).map((r) => `<@&${r}>`).join(', ') || '—'}`,
          ].join('\n'))],
        };
      }
      if (sub === 'alerts') {
        const patch = {};
        const ch = i.options.getChannel('channel');
        if (ch) patch.alert_channel = ch.id;
        if (i.options.getInteger('min_liquidity') != null) patch.min_alert_liquidity = i.options.getInteger('min_liquidity');
        if (i.options.getInteger('min_marketcap') != null) patch.min_alert_marketcap = i.options.getInteger('min_marketcap');
        if (i.options.getBoolean('multiplier_alerts') != null) patch.multiplier_alerts = i.options.getBoolean('multiplier_alerts') ? 1 : 0;
        const chains = i.options.getString('chains');
        if (chains) {
          const ids = chains.split(',').map((c) => c.trim().toLowerCase()).filter((c) => CHAINS.some((x) => x.id === c));
          patch.tracked_chains = ids;
        }
        if (!Object.keys(patch).length) return { embeds: [fail('NO CHANGES', 'Specify at least one alert setting.')] };
        const cfg = updateGuild(guildId, patch);
        audit(guildId, userId, 'alerts_updated', null, null, patch);
        return {
          embeds: [ok('admin', 'ALERT ROUTING UPDATED', [
            `CHANNEL: ${cfg.alert_channel ? `<#${cfg.alert_channel}>` : '—'}`,
            `MIN LIQUIDITY: $${num(cfg.min_alert_liquidity)}`,
            `MIN MCAP: $${num(cfg.min_alert_marketcap)}`,
            `MULTIPLIER ALERTS: ${cfg.multiplier_alerts ? 'ON' : 'OFF'}`,
            `CHAINS: ${parseRoles(cfg.tracked_chains).join(', ') || 'all live chains'}`,
          ].join('\n'))],
        };
      }
      if (sub === 'audit') {
        const rows = auditLog(guildId, 12);
        return {
          embeds: [embed('admin', {
            title: '🧾  AUDIT LOG',
            description: rows.length
              ? rows.map((r) => `\`${new Date(r.ts).toISOString().slice(11, 19)}\` **${r.action}** ${r.target_id ? `<@${r.target_id}>` : ''} ${r.amount != null ? money(r.amount) : ''} — <@${r.actor_id}>`).join('\n')
              : 'No administrative actions recorded yet.',
            footer: 'every mint, set and reset is logged',
          })],
        };
      }
      const cfg = getGuild(guildId);
      const totals = db.prepare('SELECT COUNT(*) c, SUM(cash) cash, SUM(bank) bank FROM econ_users WHERE guild_id = ?').get(String(guildId));
      return {
        embeds: [embed('admin', {
          title: '⚙️  ECONOMY SETTINGS',
          description: section('CURRENCY', [
            `NAME: **${cfg.currency_name}** ${cfg.currency_symbol}`,
            `DAILY / WEEKLY / MONTHLY: ${num(cfg.daily_amount)} / ${num(cfg.weekly_amount)} / ${num(cfg.monthly_amount)}`,
            `STARTING BALANCE: ${num(cfg.starting_balance)}`,
            `BET LIMITS: ${num(cfg.min_bet)} — ${num(cfg.max_bet)}`,
            `WORK COOLDOWN: ${duration(cfg.work_cooldown * 1000)}`,
          ]).value,
          fields: [
            section('PERMISSIONS', [
              `ADMIN ROLES: ${parseRoles(cfg.admin_role_ids).map((r) => `<@&${r}>`).join(', ') || '—'}`,
              `OWNER ROLES: ${parseRoles(cfg.owner_role_ids).map((r) => `<@&${r}>`).join(', ') || '—'}`,
            ]),
            section('SCANNER ALERTS', [
              `CHANNEL: ${cfg.alert_channel ? `<#${cfg.alert_channel}>` : '—'}`,
              `MULTIPLIER ALERTS: ${cfg.multiplier_alerts ? 'ON' : 'OFF'}`,
            ]),
            section('SUPPLY', [
              `ACCOUNTS: ${num(totals.c)}`,
              `WALLETS: ${money(totals.cash || 0, cfg.currency_symbol)}`,
              `BANKS: ${money(totals.bank || 0, cfg.currency_symbol)}`,
            ]),
          ],
          footer: 'all changes are audited',
        })],
      };
    },
  },

  auditlog: {
    data: new SlashCommandBuilder().setName('auditlog').setDescription('[ADMIN] Full administrative audit trail'),
    async run({ guildId, i }) {
      if (!isAuthorized(i)) return denied();
      const rows = auditLog(guildId, 25);
      return {
        embeds: [embed('admin', {
          title: '🧾  AUDIT TRAIL',
          description: rows.length
            ? rows.map((r) => `\`${new Date(r.ts).toISOString().slice(0, 19).replace('T', ' ')}\` **${r.action}** ${r.target_id ? `<@${r.target_id}>` : ''} ${r.amount != null ? money(r.amount) : ''}`).join('\n')
            : 'No entries.',
          footer: 'immutable append-only log',
        })],
      };
    },
  },

  economy: {
    data: new SlashCommandBuilder().setName('economy').setDescription('[ADMIN] Server economy overview'),
    async run({ guildId, i }) {
      if (!isAuthorized(i)) return denied();
      const cfg = getGuild(guildId);
      const board = leaderboard(guildId, { by: 'total', limit: 5 });
      const biz = db.prepare('SELECT COUNT(*) c FROM businesses WHERE guild_id = ?').get(String(guildId));
      const bets = db.prepare('SELECT COUNT(*) c, SUM(wager) w, SUM(payout) p FROM casino_bets WHERE guild_id = ?').get(String(guildId));
      return {
        embeds: [embed('admin', {
          title: '🏛  SERVER ECONOMY',
          description: `━━━━━━━━━━━━━━━━━━━━\nTotal supply is tracked live from account balances.\n━━━━━━━━━━━━━━━━━━━━`,
          fields: [
            section('LEADERBOARD', board.length
              ? board.map((b, idx) => `${idx + 1}. <@${b.user_id}> — ${money(b.total, cfg.currency_symbol)}`)
              : ['No accounts yet.']),
            section('ACTIVITY', [
              `BUSINESSES: ${num(biz.c)}`,
              `CASINO BETS: ${num(bets.c)} • WAGERED ${money(bets.w || 0, cfg.currency_symbol)}`,
              `PAID OUT: ${money(bets.p || 0, cfg.currency_symbol)}`,
            ]),
          ],
          footer: 'administrator view',
        })],
      };
    },
  },
};
