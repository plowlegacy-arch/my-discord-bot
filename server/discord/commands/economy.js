import { SlashCommandBuilder } from 'discord.js';
import {
  getGuild, getUser, netWorth, leaderboard, txHistory, transfer, depositBank, withdrawBank, addXp,
} from '../../economy/store.js';
import { careerList, careerLevelInfo, resolveWork, workScenario } from '../../economy/careers.js';
import { inventory, inventoryValue } from '../../economy/marketplace.js';
import { itemByKey, shopItems, rarityOf } from '../../economy/items.js';
import { profile } from '../../economy/social.js';
import {
  COLORS, ICON, block, duration, embed, errorText, fail, money, num, ok, progress, section, timeAgo,
} from '../theme.js';

// Economy surface: wallet/bank flows, daily stipends, careers, inventory and the
// leaderboards. Every mutation goes through the atomic ledger in store.js.

const coin = (v) => money(v, '⛏');

function walletEmbed(guildId, userId, title = 'WALLET') {
  const u = getUser(guildId, userId);
  const worth = netWorth(guildId, userId);
  const cfg = getGuild(guildId);
  return embed('economy', {
    title: `${ICON.wallet}  ${title}`,
    description: [
      '━━━━━━━━━━━━━━━━━━━━',
      `${ICON.coin} CASH — **${coin(u.cash)}**`,
      `${ICON.bank} BANK — **${coin(u.bank)}** / ${coin(u.bank_capacity)}`,
      `${ICON.chart} NET WORTH — **${coin(worth.total)}**`,
      '━━━━━━━━━━━━━━━━━━━━',
      `LEVEL **${u.level}**  •  XP ${num(u.xp)}`,
      `CAREER ${u.career ? `**${u.career}** (L${u.career_level})` : '— none —'}`,
      `CURRENCY ${cfg.currency_symbol} ${cfg.currency_name}`,
    ].join('\n'),
    fields: [
      section('BANK FILL', [progress(u.bank, u.bank_capacity, 10)]),
      section('ASSETS', [`Businesses ${coin(worth.businesses)}`]),
      section('ITEMS', [`${num(inventory(guildId, userId).length)} stacks`]),
    ],
    footer: 'wallet overview',
  });
}

export const economyCommands = {
  balance: {
    data: new SlashCommandBuilder().setName('balance').setDescription('Show your wallet, bank and net worth')
      .addUserOption((o) => o.setName('member').setDescription('Another member')),
    async run({ guildId, userId, i }) {
      const target = i.options.getUser('member') || { id: userId };
      return { embeds: [walletEmbed(guildId, target.id, `WALLET — ${target.id === userId ? 'YOU' : `<@${target.id}>`}`)] };
    },
  },

  wallet: {
    data: new SlashCommandBuilder().setName('wallet').setDescription('Cash on hand and recent transactions'),
    async run({ guildId, userId }) {
      const u = getUser(guildId, userId);
      const txs = txHistory(guildId, userId, 8);
      return {
        embeds: [embed('wallet', {
          title: `${ICON.wallet}  CASH WALLET`,
          description: [`━━━━━━━━━━━━━━━━━━━━`, `CASH: **${coin(u.cash)}**`, `BANK: ${coin(u.bank)}`, '━━━━━━━━━━━━━━━━━━━━'].join('\n'),
          fields: [block('RECENT TRANSACTIONS', txs.length
            ? txs.map((t) => `• ${t.amount > 0 ? '🟢 +' : '🔴 '}${coin(t.amount)} — ${t.kind} • ${timeAgo(t.ts)}`)
            : ['No transactions yet.'])],
          footer: 'wallet ledger',
        })],
      };
    },
  },

  bank: {
    data: new SlashCommandBuilder().setName('bank').setDescription('Bank balance and capacity')
      .addUserOption((o) => o.setName('member').setDescription('Another member')),
    async run({ guildId, userId, i }) {
      const target = i.options.getUser('member') || { id: userId };
      const u = getUser(guildId, target.id);
      return {
        embeds: [embed('economy', {
          title: `${ICON.bank}  BANK`,
          description: [
            '━━━━━━━━━━━━━━━━━━━━',
            `BANKED: **${coin(u.bank)}**`,
            `CAPACITY: ${coin(u.bank_capacity)}`,
            progress(u.bank, u.bank_capacity, 14),
            '━━━━━━━━━━━━━━━━━━━━',
            `CASH OUTSIDE: ${coin(u.cash)}`,
          ].join('\n'),
          footer: 'banked funds are safe from casino losses',
        })],
      };
    },
  },

  daily: { data: new SlashCommandBuilder().setName('daily').setDescription('Claim your daily stipend'), run: (c) => stipend(c, 'daily') },
  weekly: { data: new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly stipend'), run: (c) => stipend(c, 'weekly') },
  monthly: { data: new SlashCommandBuilder().setName('monthly').setDescription('Claim your monthly stipend'), run: (c) => stipend(c, 'monthly') },

  pay: {
    data: new SlashCommandBuilder().setName('pay').setDescription('Send cash to another member')
      .addUserOption((o) => o.setName('member').setDescription('Recipient').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
    run: (c) => sendCash(c),
  },

  transfer: {
    data: new SlashCommandBuilder().setName('transfer').setDescription('Transfer cash to another member')
      .addUserOption((o) => o.setName('member').setDescription('Recipient').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
    run: (c) => sendCash(c),
  },

  deposit: {
    data: new SlashCommandBuilder().setName('deposit').setDescription('Move cash into your bank')
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
    async run({ guildId, userId, i }) {
      const amount = i.options.getInteger('amount');
      const res = depositBank(guildId, userId, amount);
      if (!res.ok) return { embeds: [fail('DEPOSIT FAILED', errorText(res.reason))] };
      return {
        embeds: [ok('economy', 'DEPOSIT COMPLETE', `Moved **${coin(res.moved)}** into your bank.\n\nBANK: **${coin(res.user.bank)}**\nCASH: **${coin(res.user.cash)}**`)],
      };
    },
  },

  withdraw: {
    data: new SlashCommandBuilder().setName('withdraw').setDescription('Move cash out of your bank')
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
    async run({ guildId, userId, i }) {
      const amount = i.options.getInteger('amount');
      const res = withdrawBank(guildId, userId, amount);
      if (!res.ok) return { embeds: [fail('WITHDRAWAL FAILED', errorText(res.reason))] };
      return {
        embeds: [ok('economy', 'WITHDRAWAL COMPLETE', `Withdrew **${coin(amount)}**.\n\nCASH: **${coin(res.user.cash)}**\nBANK: **${coin(res.user.bank)}**`)],
      };
    },
  },

  work: {
    data: new SlashCommandBuilder().setName('work').setDescription('Work a shift in your career')
      .addIntegerOption((o) => o.setName('choice').setDescription('Scenario choice (1-3)').setMinValue(1).setMaxValue(3)),
    async run({ guildId, userId, i }) {
      const u = getUser(guildId, userId);
      if (!u.career) {
        return {
          embeds: [fail('NO CAREER', 'You need a career first. Run `/career` to browse the 13 tracks and `/jobs apply` to start one.')],
        };
      }
      const info = careerLevelInfo(u.career, u.career_level);
      const cooldownMs = (info.cooldown || 3600) * 1000;
      const last = u.last_work || 0;
      const wait = last + cooldownMs - Date.now();
      if (wait > 0) {
        return { embeds: [fail('SHIFT COOLDOWN', `You are still on cooldown for **${duration(wait)}**.\n\nCareer: **${info.title}**`) ] };
      }
      const scenario = workScenario(u.career_level);
      const res = resolveWork({ career: u.career, level: u.career_level, choiceIndex: (i.options.getInteger('choice') || 1) - 1 });
      const { db, now } = await import('../../db.js');
      db.prepare('UPDATE econ_users SET last_work = ?, career_xp = COALESCE(career_xp,0) + ?, updated_at = ? WHERE guild_id = ? AND user_id = ?')
        .run(now(), res.xp || 0, now(), guildId, userId);
      const { credit } = await import('../../economy/store.js');
      if (res.payout > 0) credit(guildId, userId, res.payout, 'career_work');
      addXp(guildId, userId, res.xp || 0);
      return {
        embeds: [embed('jobs', {
          title: `${ICON.coin}  SHIFT COMPLETE  •  ${info.title}`,
          description: [
            '━━━━━━━━━━━━━━━━━━━━',
            `📋 SCENARIO: ${scenario?.title || res.scenario?.title || 'Standard shift'}`,
            `🎯 CHOICE: ${res.choice?.label || `Option ${i.options.getInteger('choice') || 1}`}`,
            '',
            res.failed ? '❌ OUTCOME: SHIFT FAILED' : '✅ OUTCOME: PAID',
            `💰 PAY: **${coin(res.payout || 0)}**`,
            `⭐ CAREER XP: +${num(res.xp || 0)}`,
            '━━━━━━━━━━━━━━━━━━━━',
            `NEXT SHIFT IN ${duration(cooldownMs)}`,
          ].join('\n'),
          footer: 'career progression',
        })],
      };
    },
  },

  jobs: {
    data: new SlashCommandBuilder().setName('jobs').setDescription('Browse careers and apply')
      .addSubcommand((s) => s.setName('list').setDescription('List every career track'))
      .addSubcommand((s) => s.setName('apply').setDescription('Start a career')
        .addStringOption((o) => o.setName('career').setDescription('Career key').setRequired(true).setAutocomplete(true))),
    async autocomplete(i) {
      const focused = i.options.getFocused().toLowerCase();
      const list = careerList().filter((c) => c.key.includes(focused) || c.name.toLowerCase().includes(focused)).slice(0, 25);
      return i.respond(list.map((c) => ({ name: `${c.emoji} ${c.name}`, value: c.key })));
    },
    async run({ guildId, userId, i }) {
      if (i.options.getSubcommand() === 'list') {
        const list = careerList();
        return {
          embeds: [embed('jobs', {
            title: '💼  CAREER TRACKS',
            description: '━━━━━━━━━━━━━━━━━━━━\nEach track has 7 promotion tiers, its own salary curve, cooldown and unlockable rewards.\n━━━━━━━━━━━━━━━━━━━━',
            fields: list.slice(0, 12).map((c) => section(`${c.emoji} ${c.name}`, [`Base ${coin(c.base)}`, `${(c.levels || []).length} tiers`])),
            footer: 'use /jobs apply to start',
          })],
        };
      }
      const key = i.options.getString('career');
      const list = careerList();
      const found = list.find((c) => c.key === key);
      if (!found) return { embeds: [fail('UNKNOWN CAREER', `\`${key}\` is not a career. Run \`/jobs list\`.`) ] };
      const { db, now } = await import('../../db.js');
      const u = getUser(guildId, userId);
      db.prepare('UPDATE econ_users SET career = ?, career_level = ?, career_xp = 0, updated_at = ? WHERE guild_id = ? AND user_id = ?')
        .run(found.key, Math.max(1, u.career === found.key ? u.career_level : 1), now(), guildId, userId);
      const info = careerLevelInfo(found.key, Math.max(1, u.career_level));
      return {
        embeds: [ok('jobs', 'CAREER STARTED', [
          `You are now a **${info.title}** in the ${found.emoji} **${found.name}** track.`,
          '',
          `💰 SALARY SCALE: ${coin(info.salary || found.base)}`,
          `⏱ COOLDOWN: ${duration((info.cooldown || 3600) * 1000)}`,
          `🔓 NEXT UNLOCK: ${info.unlock || '—'}`,
        ].join('\n'))],
      };
    },
  },

  career: {
    data: new SlashCommandBuilder().setName('career').setDescription('Your career status and promotion progress'),
    async run({ guildId, userId }) {
      const u = getUser(guildId, userId);
      if (!u.career) return { embeds: [fail('NO CAREER', 'Run `/jobs list` then `/jobs apply` to start a career track.')] };
      const list = careerList();
      const meta = list.find((c) => c.key === u.career) || { name: u.career, emoji: '💼', base: 0 };
      const info = careerLevelInfo(u.career, u.career_level);
      return {
        embeds: [embed('jobs', {
          title: `${meta.emoji}  ${meta.name.toUpperCase()}  •  ${info.title}`,
          description: [
            '━━━━━━━━━━━━━━━━━━━━',
            `LEVEL: **${u.career_level}** / ${info.max_level || 7}`,
            `SALARY: **${coin(info.salary || meta.base)}**`,
            `CAREER XP: ${num(u.career_xp || 0)}${info.next_at ? ` / ${num(info.next_at)}` : ''}`,
            info.next_at ? progress(u.career_xp || 0, info.next_at, 12) : 'MAX TIER REACHED',
            '━━━━━━━━━━━━━━━━━━━━',
            `NEXT UNLOCK: ${info.unlock || '—'}`,
            `SHIFT COOLDOWN: ${duration((info.cooldown || 3600) * 1000)}`,
            `LAST SHIFT: ${timeAgo(u.last_work)}`,
          ].join('\n'),
          footer: 'career progression',
        })],
      };
    },
  },

  leaderboard: {
    data: new SlashCommandBuilder().setName('leaderboard').setDescription('Economy leaderboard')
      .addStringOption((o) => o.setName('by').setDescription('Sort field').addChoices(
        { name: 'Net worth', value: 'total' }, { name: 'Cash', value: 'cash' }, { name: 'Bank', value: 'bank' },
      )),
    async run({ guildId, i }) {
      const by = i.options.getString('by') || 'total';
      const rows = leaderboard(guildId, { by, limit: 10 });
      if (!rows.length) return { embeds: [fail('EMPTY LEADERBOARD', 'No economy activity in this server yet.')] };
      return {
        embeds: [embed('economy', {
          title: `🏆  LEADERBOARD  •  ${by.toUpperCase()}`,
          description: rows.map((r, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `\`${String(idx + 1).padStart(2, '0')}\``;
            return `${medal} <@${r.user_id}> — **${coin(r[by === 'total' ? 'total' : by])}**  ·  L${r.level}`;
          }).join('\n'),
          footer: 'server economy ranking',
        })],
      };
    },
  },

  networth: {
    data: new SlashCommandBuilder().setName('networth').setDescription('Full net worth breakdown')
      .addUserOption((o) => o.setName('member').setDescription('Another member')),
    async run({ guildId, userId, i }) {
      const target = i.options.getUser('member') || { id: userId };
      const w = netWorth(guildId, target.id);
      const items = inventoryValue(guildId, target.id);
      return {
        embeds: [embed('economy', {
          title: `${ICON.chart}  NET WORTH  •  <@${target.id}>`,
          description: [
            '━━━━━━━━━━━━━━━━━━━━',
            `👛 CASH: ${coin(w.cash)}`,
            `🏦 BANK: ${coin(w.bank)}`,
            `🏢 BUSINESSES: ${coin(w.businesses)}`,
            `🎒 ITEMS: ${coin(items)}`,
            '━━━━━━━━━━━━━━━━━━━━',
            `TOTAL: **${coin(w.total + items)}**`,
          ].join('\n'),
          footer: 'assets included at book value',
        })],
      };
    },
  },

  inventory: {
    data: new SlashCommandBuilder().setName('inventory').setDescription('Your item inventory'),
    async run({ guildId, userId }) {
      const rows = inventory(guildId, userId);
      if (!rows.length) return { embeds: [fail('EMPTY INVENTORY', 'Mine, fish, hunt or buy from `/shop` to collect items.')] };
      return {
        embeds: [embed('mining', {
          title: '🎒  INVENTORY',
          description: `━━━━━━━━━━━━━━━━━━━━\nSTACKS: **${rows.length}**  •  BOOK VALUE: **${coin(inventoryValue(guildId, userId))}**\n━━━━━━━━━━━━━━━━━━━━`,
          fields: rows.slice(0, 20).map((r) => {
            const it = itemByKey(r.item_key);
            const rar = rarityOf(r.item_key);
            return section(`${it?.emoji || '📦'} ${it?.name || r.item_key}`, [`x${num(r.qty)}`, `${rar.emoji || '•'} ${rar.name || rar}`, coin(r.total_value)]);
          }),
          footer: 'use /sell or /market list to trade',
        })],
      };
    },
  },

  shop: {
    data: new SlashCommandBuilder().setName('shop').setDescription('Browse the item shop'),
    async run() {
      const items = shopItems();
      return {
        embeds: [embed('business', {
          title: '🛒  ITEM SHOP',
          description: `━━━━━━━━━━━━━━━━━━━━\nBuy with \`/buy item:<key>\`.\n━━━━━━━━━━━━━━━━━━━━`,
          fields: items.slice(0, 18).map((it) => section(`${it.emoji} ${it.name}`, [`\`${it.key}\``, coin(it.price)])),
          footer: 'shop stock rotates with rarity',
        })],
      };
    },
  },

  buy: {
    data: new SlashCommandBuilder().setName('buy').setDescription('Buy an item from the shop')
      .addStringOption((o) => o.setName('item').setDescription('Item key').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('qty').setDescription('Quantity').setMinValue(1).setMaxValue(50)),
    async autocomplete(i) {
      const q = i.options.getFocused().toLowerCase();
      return i.respond(shopItems().filter((it) => it.key.includes(q) || it.name.toLowerCase().includes(q)).slice(0, 25)
        .map((it) => ({ name: `${it.emoji} ${it.name} — ${it.price}`, value: it.key })));
    },
    async run({ guildId, userId, i }) {
      const key = i.options.getString('item');
      const qty = i.options.getInteger('qty') || 1;
      const it = shopItems().find((x) => x.key === key);
      if (!it) return { embeds: [fail('NOT FOR SALE', `\`${key}\` is not in the shop.`) ] };
      const { debit } = await import('../../economy/store.js');
      const { addItem } = await import('../../economy/marketplace.js');
      const cost = it.price * qty;
      const paid = debit(guildId, userId, cost, 'shop_purchase', { meta: { item: key, qty } });
      if (!paid.ok) return { embeds: [fail('INSUFFICIENT FUNDS', `That costs **${coin(cost)}** and your wallet holds **${coin(paid.cash)}**.`) ] };
      addItem(guildId, userId, key, qty);
      return { embeds: [ok('business', 'PURCHASE COMPLETE', `${it.emoji} **${it.name}** x${qty}\n\nPAID: ${coin(cost)}\nWALLET: ${coin(paid.cash)}`)] };
    },
  },

  sell: {
    data: new SlashCommandBuilder().setName('sell').setDescription('Sell items back at book value')
      .addStringOption((o) => o.setName('item').setDescription('Item key').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('qty').setDescription('Quantity').setMinValue(1)),
    async autocomplete(i) {
      const q = i.options.getFocused().toLowerCase();
      return i.respond(shopItems().filter((it) => it.key.includes(q)).slice(0, 25)
        .map((it) => ({ name: `${it.emoji} ${it.name}`, value: it.key })));
    },
    async run({ guildId, userId, i }) {
      const key = i.options.getString('item');
      const qty = i.options.getInteger('qty') || 1;
      const { removeItem } = await import('../../economy/marketplace.js');
      const { credit } = await import('../../economy/store.js');
      const it = itemByKey(key);
      if (!it) return { embeds: [fail('UNKNOWN ITEM', `\`${key}\` does not exist.`) ] };
      const removed = removeItem(guildId, userId, key, qty);
      if (!removed?.ok) return { embeds: [fail('SALE FAILED', errorText(removed?.reason || 'insufficient_items'))] };
      const value = Math.round((it.value || 0) * qty * 0.85);
      credit(guildId, userId, value, 'item_sale', { meta: { item: key, qty } });
      return { embeds: [ok('business', 'SOLD', `${it.emoji} **${it.name}** x${qty} for **${coin(value)}**`)] };
    },
  },

  collect: {
    data: new SlashCommandBuilder().setName('collect').setDescription('Collect everything: business income and daily missions'),
    async run({ guildId, userId }) {
      const { collectBusinessIncome } = await import('../../economy/business.js');
      const res = collectBusinessIncome(guildId, userId);
      const { dailyMissions } = await import('../../economy/activities.js');
      const day = new Date().toISOString().slice(0, 10);
      const missions = dailyMissions(userId, day, 3);
      return {
        embeds: [embed('business', {
          title: '📥  COLLECTION SUMMARY',
          description: [
            '━━━━━━━━━━━━━━━━━━━━',
            res.ok ? `🏢 BUSINESS INCOME: **${coin(res.total)}** from ${res.collected.length} business(es)` : '🏢 BUSINESS INCOME: nothing ready yet',
            '',
            '🎯 DAILY MISSIONS',
            ...(missions || []).map((m) => `• ${m.label || m.key} — ${m.done ? '✅' : `${m.progress || 0}/${m.target || 1}`}`),
            '━━━━━━━━━━━━━━━━━━━━',
          ].join('\n'),
          footer: 'collections are credited atomically',
        })],
      };
    },
  },

  profile: {
    data: new SlashCommandBuilder().setName('profile').setDescription('Full member profile')
      .addUserOption((o) => o.setName('member').setDescription('Another member')),
    async run({ guildId, userId, i }) {
      const target = i.options.getUser('member') || { id: userId, username: 'you' };
      const w = netWorth(guildId, target.id);
      const p = profile(guildId, target.id, w.total);
      const u = w.user;
      return {
        embeds: [embed('economy', {
          title: `👤  PROFILE  •  ${target.username || `<@${target.id}>`}`,
          description: [
            '━━━━━━━━━━━━━━━━━━━━',
            `LEVEL **${u.level}**  •  XP ${num(u.xp)}`,
            `NET WORTH **${coin(w.total)}**`,
            `CAREER ${u.career ? `${u.career} (L${u.career_level})` : '—'}`,
            '━━━━━━━━━━━━━━━━━━━━',
          ].join('\n'),
          fields: [
            section('FAMILY', [`Partner: ${p.partner ? `<@${p.partner}>` : '—'}`, `Children: ${num((p.children || []).length)}`]),
            section('ACHIEVEMENTS', [`${num((p.achievements || []).length)} unlocked`]),
            section('CASINO', [`Bets: ${num(p.casino?.bets || 0)}`]),
          ],
          footer: 'member profile',
        })],
      };
    },
  },
};

/* ------------------------------------------------------------- helpers */

async function stipend({ guildId, userId, i }, kind) {
  const cfg = getGuild(guildId);
  const { db, now } = await import('../../db.js');
  const { credit } = await import('../../economy/store.js');
  const col = `last_${kind}`;
  const u = getUser(guildId, userId);
  const amount = cfg[`${kind}_amount`];
  const cooldown = kind === 'daily' ? 86400000 : kind === 'weekly' ? 604800000 : 2592000000;
  const last = u[col] || 0;
  const wait = last + cooldown - Date.now();
  if (wait > 0) {
    return { embeds: [fail('ALREADY CLAIMED', `Come back in **${duration(wait)}** for your next ${kind} reward.`)] };
  }
  credit(guildId, userId, amount, `${kind}_stipend`);
  db.prepare(`UPDATE econ_users SET ${col} = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?`).run(now(), now(), guildId, userId);
  addXp(guildId, userId, Math.round(amount / 20));
  const after = getUser(guildId, userId);
  return {
    embeds: [ok('economy', `${kind.toUpperCase()} CLAIMED`, [
      `You received **${coin(amount)}**.`,
      '',
      `WALLET: **${coin(after.cash)}**`,
      `NEXT ${kind.toUpperCase()}: in ${duration(cooldown)}`,
    ].join('\n'))],
  };
}

async function sendCash({ guildId, userId, i }) {
  const target = i.options.getUser('member');
  const amount = i.options.getInteger('amount');
  if (target.id === userId) return { embeds: [fail('INVALID TRANSFER', 'You cannot pay yourself.')] };
  if (target.bot) return { embeds: [fail('INVALID TRANSFER', 'Bots do not hold wallets.')] };
  const res = transfer(guildId, userId, target.id, amount, 'transfer');
  if (!res.ok) return { embeds: [fail('TRANSFER FAILED', errorText(res.reason))] };
  return {
    embeds: [ok('economy', 'TRANSFER COMPLETE', [
      `**${coin(amount)}** sent to <@${target.id}>.`,
      '',
      `YOUR WALLET: ${coin(res.from.cash)}`,
      `THEIR WALLET: ${coin(res.to.cash)}`,
    ].join('\n'))],
  };
}

export { walletEmbed };
