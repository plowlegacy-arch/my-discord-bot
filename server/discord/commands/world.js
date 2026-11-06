import { SlashCommandBuilder } from 'discord.js';
import { db, now } from '../../db.js';
import { credit, debit, getUser, addXp, netWorth, audit } from '../../economy/store.js';
import {
  BUSINESS_TYPES, buyBusiness, upgradeBusiness, hireStaff, collectBusinessIncome,
  buyAsset, assetList, businessList, businessById, upgradeCost,
} from '../../economy/business.js';
import {
  inventory, createListing, cancelListing, buyListing, bidAuction, settleAuction,
  listings, openTrade, setTradeOffer, confirmTrade, cancelTrade, getTrade,
} from '../../economy/marketplace.js';
import { ACTIVITIES, rollActivity, dailyMissions, ACHIEVEMENTS } from '../../economy/activities.js';
import {
  MARRIAGE_COST, propose, acceptProposal, divorce, adopt, familyProfile, achievementsOf, evaluateAchievements,
} from '../../economy/social.js';
import { itemByKey, rarityOf, ITEMS } from '../../economy/items.js';
import {
  createGiveaway, enterGiveaway, listGiveaways, rerollGiveaway, drawGiveaway, getGiveaway, ENTRY_REQUIREMENTS,
} from '../../economy/giveaways.js';
import {
  ICON, block, duration, embed, errorText, fail, money, num, ok, progress, section, short, timeAgo,
} from '../theme.js';

// World layer: businesses, assets, marketplace, trading, relationships and the
// gathering activities. All state changes go through transactional engine calls.

const coin = (v) => money(v, '⛏');

db.exec(`CREATE TABLE IF NOT EXISTS activity_cooldowns (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, activity TEXT NOT NULL,
  last_at INTEGER NOT NULL, total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, activity)
);`);

const activityGate = (guildId, userId, key, cooldownMs) => {
  const row = db.prepare('SELECT * FROM activity_cooldowns WHERE guild_id = ? AND user_id = ? AND activity = ?')
    .get(String(guildId), String(userId), key);
  const readyAt = (row?.last_at || 0) + cooldownMs;
  return { row, wait: Math.max(0, readyAt - Date.now()) };
};

const stampActivity = (guildId, userId, key) => {
  db.prepare(`INSERT INTO activity_cooldowns (guild_id, user_id, activity, last_at, total) VALUES (?,?,?,?,1)
    ON CONFLICT(guild_id, user_id, activity) DO UPDATE SET last_at = excluded.last_at, total = total + 1`)
    .run(String(guildId), String(userId), key, now());
};

async function gather({ guildId, userId }, key) {
  const act = ACTIVITIES[key];
  const gate = activityGate(guildId, userId, key, act.cooldown);
  if (gate.wait > 0) {
    return { embeds: [fail('COOLDOWN', `Your ${act.name.toLowerCase()} crew is resting for **${duration(gate.wait)}**.`)] };
  }
  const luck = Math.min(0.35, (gate.row?.total || 0) * 0.01);
  const res = rollActivity(key, { luck });
  stampActivity(guildId, userId, key);
  credit(guildId, userId, res.cash, `activity_${key}`, { meta: { item: res.item.key } });
  const { addItem } = await import('../../economy/marketplace.js');
  addItem(guildId, userId, res.item.key, 1);
  addXp(guildId, userId, res.xp || 5);
  const u = getUser(guildId, userId);
  return {
    embeds: [embed(key === 'mine' ? 'mining' : 'economy', {
      title: `${res.emoji}  ${res.name.toUpperCase()}  •  ${res.rarity.name.toUpperCase()}`,
      description: [
        '━━━━━━━━━━━━━━━━━━━━',
        `*${res.flavor}*`,
        '━━━━━━━━━━━━━━━━━━━━',
        `${res.rarity.emoji} FOUND: **${res.item.emoji} ${res.item.name}** (${res.rarity.name})`,
        `💰 CASH: **${coin(res.cash)}**${res.bonus ? '  ✨ DOUBLE HAUL' : ''}`,
        `⭐ XP: +${num(res.xp)}`,
        '━━━━━━━━━━━━━━━━━━━━',
        `WALLET: **${coin(u.cash)}**`,
        `NEXT RUN IN ${duration(act.cooldown)}`,
      ].join('\n'),
      footer: `${act.name} • luck bonus +${(luck * 100).toFixed(0)}%`,
    })],
  };
}

export const worldCommands = {
  business: {
    data: new SlashCommandBuilder().setName('business').setDescription('Business portfolio: buy, upgrade, hire, collect')
      .addSubcommand((s) => s.setName('portfolio').setDescription('Your businesses and pending income'))
      .addSubcommand((s) => s.setName('types').setDescription('Business catalogue'))
      .addSubcommand((s) => s.setName('buy').setDescription('Buy a business')
        .addStringOption((o) => o.setName('type').setDescription('Business type').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('name').setDescription('Custom name')))
      .addSubcommand((s) => s.setName('upgrade').setDescription('Upgrade a business')
        .addIntegerOption((o) => o.setName('id').setDescription('Business id').setRequired(true)))
      .addSubcommand((s) => s.setName('hire').setDescription('Hire staff')
        .addIntegerOption((o) => o.setName('id').setDescription('Business id').setRequired(true))
        .addIntegerOption((o) => o.setName('count').setDescription('Staff to hire').setMinValue(1).setMaxValue(10)))
      .addSubcommand((s) => s.setName('collect').setDescription('Collect accrued income')
        .addIntegerOption((o) => o.setName('id').setDescription('Business id (omit for all)'))),
    async autocomplete(i) {
      const q = i.options.getFocused().toLowerCase();
      return i.respond(Object.entries(BUSINESS_TYPES)
        .filter(([k, v]) => k.includes(q) || v.name.toLowerCase().includes(q)).slice(0, 25)
        .map(([k, v]) => ({ name: `${v.emoji} ${v.name} — ${v.cost}`, value: k })));
    },
    async run({ guildId, userId, i }) {
      const sub = i.options.getSubcommand();
      if (sub === 'types') {
        return {
          embeds: [embed('business', {
            title: '🏢  BUSINESS CATALOGUE',
            description: `━━━━━━━━━━━━━━━━━━━━\nUp to 12 businesses per member. Income accrues per cycle, capped at 12 cycles.\n━━━━━━━━━━━━━━━━━━━━`,
            fields: Object.entries(BUSINESS_TYPES).slice(0, 12).map(([k, v]) => section(`${v.emoji} ${v.name}`, [
              `\`${k}\``, `cost ${coin(v.cost)}`, `base ${coin(v.base_income)}/${Math.round(v.cycle / 60)}m`, `max L${v.max_level}`,
            ])),
            footer: 'buy with /business buy',
          })],
        };
      }
      if (sub === 'buy') {
        const res = buyBusiness(guildId, userId, i.options.getString('type'), i.options.getString('name'));
        if (!res.ok) return { embeds: [fail('PURCHASE FAILED', errorText(res.reason))] };
        return {
          embeds: [ok('business', 'BUSINESS ACQUIRED', [
            `**${res.business.name}** is now open (#${res.business.id}).`,
            '',
            `PAID: ${coin(res.cost)}`,
            `INCOME: ${coin(res.business.meta.income)} per cycle`,
            `UPKEEP: ${coin(res.business.meta.upkeep)} per cycle`,
          ].join('\n'))],
        };
      }
      if (sub === 'upgrade') {
        const res = upgradeBusiness(guildId, userId, i.options.getInteger('id'));
        if (!res.ok) return { embeds: [fail('UPGRADE FAILED', errorText(res.reason))] };
        return {
          embeds: [ok('business', 'UPGRADE COMPLETE', `**${res.business.name}** is now level **${res.business.level}**.\n\nPAID: ${coin(res.cost)}\nINCOME: ${coin(res.business.meta.income)} / cycle`)],
        };
      }
      if (sub === 'hire') {
        const res = hireStaff(guildId, userId, i.options.getInteger('id'), i.options.getInteger('count') || 1);
        if (!res.ok) return { embeds: [fail('HIRING FAILED', errorText(res.reason))] };
        return {
          embeds: [ok('business', 'STAFF HIRED', `Hired **${res.hired}** employee(s).\n\nPAID: ${coin(res.cost)}\nSTAFF: ${res.business.staff}\nINCOME: ${coin(res.business.meta.income)} / cycle`)],
        };
      }
      if (sub === 'collect') {
        const res = collectBusinessIncome(guildId, userId, i.options.getInteger('id'));
        if (!res.ok) return { embeds: [fail('NOTHING TO COLLECT', errorText(res.reason))] };
        return {
          embeds: [ok('business', 'INCOME COLLECTED', [
            `Collected **${coin(res.total)}** from ${res.collected.length} business(es).`,
            '',
            ...res.collected.map((c) => `• ${c.name} — ${coin(c.amount)}`),
            '',
            `WALLET: **${coin(res.cash)}**`,
          ].join('\n'))],
        };
      }
      const rows = businessList(guildId, userId);
      if (!rows.length) return { embeds: [fail('NO BUSINESSES', 'You do not own a business yet. Run `/business types` then `/business buy`.')] };
      const total = rows.reduce((a, b) => a + b.meta.pending, 0);
      return {
        embeds: [embed('business', {
          title: '🏢  BUSINESS PORTFOLIO',
          description: `━━━━━━━━━━━━━━━━━━━━\nOWNED: **${rows.length}**  •  PENDING: **${coin(total)}**\n━━━━━━━━━━━━━━━━━━━━`,
          fields: rows.slice(0, 12).map((b) => section(`${b.name}  •  #${b.id}`, [
            `L${b.level}  •  staff ${b.staff}`,
            `income ${coin(b.meta.income)}  •  upkeep ${coin(b.meta.upkeep)}`,
            `pending ${coin(b.meta.pending)}`,
            `next upgrade ${coin(upgradeCost(b.type, b.level + 1))}`,
          ])),
          footer: 'collect with /business collect',
        })],
      };
    },
  },

  property: {
    data: new SlashCommandBuilder().setName('property').setDescription('Homes, vehicles and your asset portfolio')
      .addSubcommand((s) => s.setName('list').setDescription('Asset catalogue'))
      .addSubcommand((s) => s.setName('buy').setDescription('Buy an asset')
        .addStringOption((o) => o.setName('key').setDescription('Asset key').setRequired(true).setAutocomplete(true)))
      .addSubcommand((s) => s.setName('mine').setDescription('Your owned assets')),
    async autocomplete(i) {
      const q = i.options.getFocused().toLowerCase();
      return i.respond(assetList().filter((a) => a.key.includes(q) || a.name.toLowerCase().includes(q)).slice(0, 25)
        .map((a) => ({ name: `${a.name} — ${a.cost}`, value: a.key })));
    },
    async run({ guildId, userId, i }) {
      const sub = i.options.getSubcommand();
      if (sub === 'list') {
        return {
          embeds: [embed('business', {
            title: '🏘  ASSET CATALOGUE',
            description: `━━━━━━━━━━━━━━━━━━━━\nProperties generate passive income; vehicles are pure collectibles.\n━━━━━━━━━━━━━━━━━━━━`,
            fields: assetList().slice(0, 18).map((a) => section(`${a.kind === 'house' ? '🏠' : '🚗'} ${a.name}`, [
              `\`${a.key}\``, coin(a.cost), a.income ? `+${coin(a.income)}/cycle` : 'no income',
            ])),
            footer: 'buy with /property buy',
          })],
        };
      }
      if (sub === 'buy') {
        const res = buyAsset(guildId, userId, i.options.getString('key'));
        if (!res.ok) return { embeds: [fail('PURCHASE FAILED', errorText(res.reason))] };
        return { embeds: [ok('business', 'ASSET ACQUIRED', `**${res.asset.name}** added to your portfolio.\n\nPAID: ${coin(res.asset.cost)}`)] };
      }
      const rows = db.prepare('SELECT * FROM assets WHERE guild_id = ? AND user_id = ? ORDER BY acquired_at DESC')
        .all(String(guildId), String(userId));
      return {
        embeds: [embed('business', {
          title: '🏡  YOUR ASSETS',
          description: rows.length
            ? rows.map((r) => `• ${r.kind === 'house' ? '🏠' : '🚗'} **${assetList().find((a) => a.key === r.key)?.name || r.key}** — acquired ${timeAgo(r.acquired_at)}`).join('\n')
            : 'No assets yet.',
          footer: 'assets count toward net worth',
        })],
      };
    },
  },

  market: {
    data: new SlashCommandBuilder().setName('market').setDescription('Player marketplace: listings, auctions, purchases')
      .addSubcommand((s) => s.setName('browse').setDescription('Open listings'))
      .addSubcommand((s) => s.setName('list').setDescription('List an item for sale')
        .addStringOption((o) => o.setName('item').setDescription('Item key').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('qty').setDescription('Quantity').setMinValue(1))
        .addIntegerOption((o) => o.setName('price').setDescription('Price per stack').setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName('auction').setDescription('Start an auction')
        .addStringOption((o) => o.setName('item').setDescription('Item key').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('qty').setDescription('Quantity').setMinValue(1))
        .addIntegerOption((o) => o.setName('start').setDescription('Starting bid').setRequired(true).setMinValue(1))
        .addIntegerOption((o) => o.setName('hours').setDescription('Duration in hours').setMinValue(1).setMaxValue(72)))
      .addSubcommand((s) => s.setName('buy').setDescription('Buy a listing')
        .addIntegerOption((o) => o.setName('id').setDescription('Listing id').setRequired(true)))
      .addSubcommand((s) => s.setName('bid').setDescription('Bid on an auction')
        .addIntegerOption((o) => o.setName('id').setDescription('Listing id').setRequired(true))
        .addIntegerOption((o) => o.setName('amount').setDescription('Bid amount').setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName('cancel').setDescription('Cancel your listing')
        .addIntegerOption((o) => o.setName('id').setDescription('Listing id').setRequired(true))),
    async autocomplete(i) {
      const q = i.options.getFocused().toLowerCase();
      const owned = inventory(i.guildId, i.user.id).map((r) => r.item_key);
      const pool = owned.length ? owned : Object.keys(ITEMS);
      return i.respond([...new Set(pool)].filter((k) => k.includes(q)).slice(0, 25)
        .map((k) => ({ name: `${ITEMS[k].emoji} ${ITEMS[k].name}`, value: k })));
    },
    async run({ guildId, userId, i }) {
      const sub = i.options.getSubcommand();
      if (sub === 'browse') {
        const rows = listings(guildId, { status: 'open', limit: 15 });
        return {
          embeds: [embed('business', {
            title: '🛒  MARKETPLACE',
            description: rows.length
              ? rows.map((r) => {
                const it = itemByKey(r.item_key);
                return `\`#${r.id}\` ${it?.emoji || '📦'} **${it?.name || r.item_key}** x${r.qty} — ${coin(r.price)} ${r.kind === 'auction' ? `(auction, ends ${r.ends_at ? timeAgo(r.ends_at) : '—'})` : ''} • <@${r.seller_id}>`;
              }).join('\n')
              : 'No open listings. Use `/market list` to sell something.',
            footer: '2% listing fee • /market buy id:<n>',
          })],
        };
      }
      if (sub === 'list' || sub === 'auction') {
        const item = i.options.getString('item');
        const qty = i.options.getInteger('qty') || 1;
        const price = i.options.getInteger(sub === 'list' ? 'price' : 'start');
        const hours = i.options.getInteger('hours') || 12;
        const res = createListing(guildId, userId, item, qty, price, {
          kind: sub === 'auction' ? 'auction' : 'fixed',
          durationMs: sub === 'auction' ? hours * 3600 * 1000 : null,
        });
        if (!res.ok) return { embeds: [fail('LISTING FAILED', errorText(res.reason))] };
        return { embeds: [ok('business', 'LISTING CREATED', `Listing **#${res.id}** is live.\n\nFEE: ${coin(res.fee)}\n${sub === 'auction' ? `AUCTION ENDS IN ${hours}h` : `PRICE: ${coin(price)}`}`)] };
      }
      if (sub === 'buy') {
        const res = buyListing(guildId, i.options.getInteger('id'), userId);
        if (!res.ok) return { embeds: [fail('PURCHASE FAILED', errorText(res.reason))] };
        const it = itemByKey(res.listing.item_key);
        return { embeds: [ok('business', 'PURCHASE COMPLETE', `Bought ${it?.emoji || '📦'} **${it?.name || res.listing.item_key}** x${res.listing.qty} for **${coin(res.total)}**.`)] };
      }
      if (sub === 'bid') {
        const res = bidAuction(guildId, i.options.getInteger('id'), userId, i.options.getInteger('amount'));
        if (!res.ok) return { embeds: [fail('BID REJECTED', errorText(res.reason))] };
        return { embeds: [ok('business', 'BID PLACED', `You now hold the highest bid at **${coin(res.current)}**.`)] };
      }
      const res = cancelListing(guildId, i.options.getInteger('id'), userId);
      if (!res.ok) return { embeds: [fail('CANCEL FAILED', errorText(res.reason))] };
      return { embeds: [ok('business', 'LISTING CANCELLED', 'The items are back in your inventory.')] };
    },
  },

  trade: {
    data: new SlashCommandBuilder().setName('trade').setDescription('Direct player-to-player trades with double confirmation')
      .addSubcommand((s) => s.setName('offer').setDescription('Open or update a trade')
        .addUserOption((o) => o.setName('member').setDescription('Trade partner').setRequired(true))
        .addIntegerOption((o) => o.setName('cash').setDescription('Cash you are adding'))
        .addStringOption((o) => o.setName('item').setDescription('Item you are adding').setAutocomplete(true))
        .addIntegerOption((o) => o.setName('qty').setDescription('Item quantity').setMinValue(1)))
      .addSubcommand((s) => s.setName('view').setDescription('View a trade')
        .addUserOption((o) => o.setName('member').setDescription('Trade partner').setRequired(true)))
      .addSubcommand((s) => s.setName('confirm').setDescription('Confirm the trade')
        .addUserOption((o) => o.setName('member').setDescription('Trade partner').setRequired(true)))
      .addSubcommand((s) => s.setName('cancel').setDescription('Cancel the trade')
        .addUserOption((o) => o.setName('member').setDescription('Trade partner').setRequired(true))),
    async autocomplete(i) {
      const q = i.options.getFocused().toLowerCase();
      return i.respond(inventory(i.guildId, i.user.id).filter((r) => r.item_key.includes(q)).slice(0, 25)
        .map((r) => ({ name: `${ITEMS[r.item_key]?.emoji || '📦'} ${ITEMS[r.item_key]?.name || r.item_key} (x${r.qty})`, value: r.item_key })));
    },
    async run({ guildId, userId, i }) {
      const sub = i.options.getSubcommand();
      const partner = i.options.getUser('member');
      if (partner.id === userId) return { embeds: [fail('INVALID TRADE', 'You cannot trade with yourself.')] };
      if (sub === 'offer') {
        const opened = openTrade(guildId, userId, partner.id);
        if (!opened?.ok) return { embeds: [fail('TRADE FAILED', errorText(opened?.reason))] };
        const item = i.options.getString('item');
        const qty = i.options.getInteger('qty') || 1;
        const res = setTradeOffer(guildId, userId, partner.id, userId, {
          cash: i.options.getInteger('cash') || 0,
          items: item ? [{ key: item, qty }] : [],
        });
        if (!res?.ok) return { embeds: [fail('OFFER REJECTED', errorText(res?.reason))] };
        const t = getTrade(guildId, userId, partner.id);
        return { embeds: [embed('business', {
          title: '🤝  TRADE OFFER',
          description: [
            '━━━━━━━━━━━━━━━━━━━━',
            `<@${userId}> → <@${partner.id}>`,
            `CASH: ${coin(i.options.getInteger('cash') || 0)}`,
            `ITEMS: ${item ? `${item} x${qty}` : '—'}`,
            '━━━━━━━━━━━━━━━━━━━━',
            'Both sides must confirm with `/trade confirm` before anything moves.',
          ].join('\n'),
          footer: `trade #${t?.id ?? '—'}`,
        })] };
      }
      if (sub === 'view') {
        const t = getTrade(guildId, userId, partner.id);
        if (!t) return { embeds: [fail('NO TRADE', 'There is no open trade between you two.')] };
        return { embeds: [embed('business', { title: `🤝  TRADE #${t.id}`, description: `\`\`\`json\n${JSON.stringify(t.offers || t, null, 1).slice(0, 1500)}\n\`\`\``, footer: 'confirm to settle' })] };
      }
      if (sub === 'cancel') {
        cancelTrade(guildId, userId, partner.id);
        return { embeds: [ok('business', 'TRADE CANCELLED', 'Nothing moved.')] };
      }
      const res = confirmTrade(guildId, userId, partner.id, userId);
      if (!res.ok) return { embeds: [fail('CONFIRMATION FAILED', errorText(res.reason))] };
      return {
        embeds: [ok('business', res.settled ? 'TRADE SETTLED' : 'CONFIRMATION RECORDED',
          res.settled ? 'Both sides confirmed — items and cash have moved.' : 'Waiting for your partner to confirm.')],
      };
    },
  },

  marry: {
    data: new SlashCommandBuilder().setName('marry').setDescription('Propose to another member')
      .addUserOption((o) => o.setName('member').setDescription('Your partner').setRequired(true)),
    async run({ guildId, userId, i }) {
      const target = i.options.getUser('member');
      if (target.id === userId) return { embeds: [fail('INVALID', 'You cannot marry yourself.')] };
      const res = propose(guildId, userId, target.id);
      if (!res.ok) return { embeds: [fail('PROPOSAL FAILED', errorText(res.reason))] };
      return {
        embeds: [ok('economy', 'PROPOSAL SENT', [
          `<@${userId}> proposed to <@${target.id}>!`,
          '',
          `COST: ${coin(MARRIAGE_COST)} (charged on acceptance)`,
          `They can accept with \`/family accept member:@${i.user.username}\`.`,
        ].join('\n'))],
      };
    },
  },

  family: {
    data: new SlashCommandBuilder().setName('family').setDescription('Relationships, children and family profile')
      .addSubcommand((s) => s.setName('accept').setDescription('Accept a proposal')
        .addUserOption((o) => o.setName('member').setDescription('Who proposed').setRequired(true)))
      .addSubcommand((s) => s.setName('divorce').setDescription('End your marriage'))
      .addSubcommand((s) => s.setName('adopt').setDescription('Adopt a member')
        .addUserOption((o) => o.setName('member').setDescription('Child').setRequired(true)))
      .addSubcommand((s) => s.setName('show').setDescription('Family profile')),
    async run({ guildId, userId, i }) {
      const sub = i.options.getSubcommand();
      if (sub === 'accept') {
        const res = acceptProposal(guildId, i.options.getUser('member').id, userId);
        if (!res.ok) return { embeds: [fail('ACCEPT FAILED', errorText(res.reason))] };
        return { embeds: [ok('economy', 'MARRIAGE CONFIRMED', 'The wedding is official. Shared family profile unlocked.')] };
      }
      if (sub === 'divorce') {
        const res = divorce(guildId, userId);
        if (!res.ok) return { embeds: [fail('DIVORCE FAILED', errorText(res.reason))] };
        return { embeds: [ok('economy', 'MARRIAGE ENDED', 'Your family profile has been dissolved.')] };
      }
      if (sub === 'adopt') {
        const res = adopt(guildId, userId, i.options.getUser('member').id);
        if (!res.ok) return { embeds: [fail('ADOPTION FAILED', errorText(res.reason))] };
        return { embeds: [ok('economy', 'FAMILY EXPANDED', 'Your family tree grew by one.')] };
      }
      const f = familyProfile(guildId, userId);
      return {
        embeds: [embed('economy', {
          title: '👪  FAMILY PROFILE',
          description: [
            '━━━━━━━━━━━━━━━━━━━━',
            `PARTNER: ${f.partner || f.spouse ? `<@${f.partner || f.spouse}>` : '—'}`,
            `CHILDREN: ${(f.children || []).length ? (f.children || []).map((c) => `<@${c}>`).join(', ') : '—'}`,
            '━━━━━━━━━━━━━━━━━━━━',
          ].join('\n'),
          footer: 'family ties persist across sessions',
        })],
      };
    },
  },

  achievements: {
    data: new SlashCommandBuilder().setName('achievements').setDescription('Achievements and progress'),
    async run({ guildId, userId }) {
      const w = netWorth(guildId, userId);
      evaluateAchievements(guildId, userId, w.total, w.user.level);
      const unlocked = achievementsOf(guildId, userId);
      const keys = new Set(unlocked.map((a) => a.key || a.achievement_key));
      return {
        embeds: [embed('economy', {
          title: '🏅  ACHIEVEMENTS',
          description: `━━━━━━━━━━━━━━━━━━━━\nUNLOCKED: **${keys.size}** / ${Object.keys(ACHIEVEMENTS).length}\n━━━━━━━━━━━━━━━━━━━━`,
          fields: Object.entries(ACHIEVEMENTS).slice(0, 18).map(([k, a]) => section(
            `${keys.has(k) ? '✅' : '🔒'} ${a.name || k}`, [a.description || a.desc || '—'],
          )),
          footer: 'achievements award XP automatically',
        })],
      };
    },
  },

  mine: { data: new SlashCommandBuilder().setName('mine').setDescription('Mine for ore, gems and rare finds'), run: (c) => gather(c, 'mine') },
  fish: { data: new SlashCommandBuilder().setName('fish').setDescription('Fish the trenches for catches'), run: (c) => gather(c, 'fish') },
  hunt: { data: new SlashCommandBuilder().setName('hunt').setDescription('Hunt for trophies and pelts'), run: (c) => gather(c, 'hunt') },
  treasure: { data: new SlashCommandBuilder().setName('treasure').setDescription('Hunt for buried treasure'), run: (c) => gather(c, 'treasure') },
  explore: { data: new SlashCommandBuilder().setName('explore').setDescription('Explore new regions for discoveries'), run: (c) => gather(c, 'explore') },

  missions: {
    data: new SlashCommandBuilder().setName('missions').setDescription('Daily missions and streak progress'),
    async run({ guildId, userId }) {
      const day = new Date().toISOString().slice(0, 10);
      const missions = dailyMissions(userId, day, 3);
      const u = getUser(guildId, userId);
      return {
        embeds: [embed('jobs', {
          title: '🎯  DAILY MISSIONS',
          description: `━━━━━━━━━━━━━━━━━━━━\nSTREAK: **${u.streak || 0}** days  •  LEVEL **${u.level}**\n━━━━━━━━━━━━━━━━━━━━`,
          fields: (missions || []).map((m) => section(`${m.done ? '✅' : '⬜'} ${m.label}`, [
            `progress ${m.progress || 0}/${m.target || 1}`,
            `reward ${coin(m.reward)}`,
          ])),
          footer: 'missions reset at 00:00 UTC',
        })],
      };
    },
  },

  giveaway: {
    data: new SlashCommandBuilder().setName('giveaway').setDescription('Giveaways: create, enter, list, reroll')
      .addSubcommand((s) => s.setName('create').setDescription('Host a giveaway')
        .addStringOption((o) => o.setName('prize').setDescription('Prize label').setRequired(true))
        .addStringOption((o) => o.setName('kind').setDescription('currency | item | custom').addChoices(
          { name: 'currency', value: 'currency' }, { name: 'item', value: 'item' }, { name: 'custom', value: 'custom' }))
        .addIntegerOption((o) => o.setName('amount').setDescription('Currency amount'))
        .addStringOption((o) => o.setName('item').setDescription('Item key for item prizes'))
        .addIntegerOption((o) => o.setName('winners').setDescription('Winner count').setMinValue(1).setMaxValue(20))
        .addIntegerOption((o) => o.setName('minutes').setDescription('Duration in minutes').setMinValue(1).setMaxValue(43200))
        .addStringOption((o) => o.setName('requirement').setDescription('Entry requirement').addChoices(
          ...Object.keys(ENTRY_REQUIREMENTS).slice(0, 10).map((k) => ({ name: k, value: k })))))
      .addSubcommand((s) => s.setName('enter').setDescription('Enter a giveaway')
        .addIntegerOption((o) => o.setName('id').setDescription('Giveaway id').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('Open giveaways'))
      .addSubcommand((s) => s.setName('reroll').setDescription('Reroll winners')
        .addIntegerOption((o) => o.setName('id').setDescription('Giveaway id').setRequired(true)))
      .addSubcommand((s) => s.setName('draw').setDescription('Draw now')
        .addIntegerOption((o) => o.setName('id').setDescription('Giveaway id').setRequired(true))),
    async run({ guildId, userId, i }) {
      const sub = i.options.getSubcommand();
      if (sub === 'create') {
        const kind = i.options.getString('kind') || 'currency';
        const amount = i.options.getInteger('amount') || 10000;
        const res = createGiveaway(guildId, userId, {
          prize: i.options.getString('prize'),
          prizeKind: kind,
          prizeAmount: kind === 'currency' ? amount : null,
          prizeItem: kind === 'item' ? i.options.getString('item') : null,
          winners: i.options.getInteger('winners') || 1,
          requirement: i.options.getString('requirement') || 'none',
          durationMs: (i.options.getInteger('minutes') || 60) * 60 * 1000,
          channelId: i.channelId,
        });
        return {
          embeds: [ok('giveaway', 'GIVEAWAY LIVE', [
            `🎁 **${i.options.getString('prize')}**`,
            '',
            `ID: \`#${res.id}\``,
            `WINNERS: ${i.options.getInteger('winners') || 1}`,
            `ENDS: ${timeAgo(res.ends_at)}`,
            `ENTRY: \`/giveaway enter id:${res.id}\``,
          ].join('\n'))],
        };
      }
      if (sub === 'enter') {
        const res = enterGiveaway(guildId, i.options.getInteger('id'), userId);
        if (!res.ok) return { embeds: [fail('ENTRY FAILED', res.detail || errorText(res.reason))] };
        return { embeds: [ok('giveaway', 'ENTRY CONFIRMED', `You are in. Total entries: **${res.count}**.`)] };
      }
      if (sub === 'reroll') {
        const res = rerollGiveaway(guildId, i.options.getInteger('id'));
        if (!res.ok) return { embeds: [fail('REROLL FAILED', errorText(res.reason))] };
        return { embeds: [ok('giveaway', 'WINNERS REROLLED', (res.winners || []).map((w) => `• <@${w}>`).join('\n') || 'No eligible entries.')] };
      }
      if (sub === 'draw') {
        const res = drawGiveaway(guildId, i.options.getInteger('id'), { force: true });
        if (!res.ok) return { embeds: [fail('DRAW FAILED', errorText(res.reason))] };
        return { embeds: [ok('giveaway', 'WINNERS DRAWN', (res.winners || []).map((w) => `• <@${w}>`).join('\n') || 'No entries — no winner.')] };
      }
      const rows = listGiveaways(guildId, 'open');
      return {
        embeds: [embed('giveaway', {
          title: '🎁  OPEN GIVEAWAYS',
          description: rows.length
            ? rows.map((g) => `\`#${g.id}\` **${g.prize}** — ${g.winners} winner(s) • ${(JSON.parse(g.entries || '[]')).length} entries • ends ${timeAgo(g.ends_at)}`).join('\n')
            : 'No open giveaways. Host one with `/giveaway create`.',
          footer: 'entry requirements enforced on join',
        })],
      };
    },
  },
};

export { gather };
