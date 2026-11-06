import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  GAME_ORDER, gameList, playGame, betHistory, casinoLeaderboard, casinoStats,
  buyLotteryTicket, currentLotteryRound, LOTTERY_TICKET, seedState, rotateSeed,
} from '../../economy/casino.js';
import { getUser, netWorth } from '../../economy/store.js';
import {
  COLORS, ICON, block, duration, embed, errorText, fail, money, num, ok, progress, section, timeAgo,
} from '../theme.js';

// Casino surface. Every wager runs through playGame() — a single SQLite
// transaction that validates funds, records the provably-fair seed pair and
// settles the payout, so double spends and duplicate payouts are impossible.

const coin = (v) => money(v, '⛏');

const WAGER = (o) => o.setName('wager').setDescription('Wager in cash').setRequired(true).setMinValue(10).setMaxValue(10000000);

function settledEmbed(res, title) {
  const win = (res.net ?? (res.payout - res.wager)) > 0;
  return embed(win ? 'casinoWin' : 'casinoLoss', {
    title: `${win ? '🟢' : '🔴'}  ${title}  •  ${win ? 'WIN' : 'LOSS'}`,
    description: [
      '━━━━━━━━━━━━━━━━━━━━',
      res.result?.summary ? `${res.result.summary}` : '',
      res.result?.detail ? `${res.result.detail}` : '',
      '━━━━━━━━━━━━━━━━━━━━',
      `WAGER: **${coin(res.wager)}**`,
      `PAYOUT: **${coin(res.payout)}**`,
      `NET: ${res.net >= 0 ? '🟢 +' : '🔴 '}**${coin(res.net)}**`,
      `MULTIPLIER: ${(res.multiplier ?? (res.wager ? res.payout / res.wager : 0)).toFixed(2)}x`,
      '━━━━━━━━━━━━━━━━━━━━',
      `WALLET: **${coin(res.cash)}**`,
    ].filter(Boolean).join('\n'),
    footer: 'provably fair • seed pair recorded',
  });
}

function gameEmbed() {
  const games = gameList();
  return embed('casino', {
    title: '🎰  TRENCH CASINO',
    description: [
      '━━━━━━━━━━━━━━━━━━━━',
      'Nine provably-fair games plus a rolling server lottery.',
      'Every wager is validated against your cash balance inside one transaction.',
      '━━━━━━━━━━━━━━━━━━━━',
    ].join('\n'),
    fields: games.slice(0, 9).map((g) => section(`${g.emoji || '🎲'} ${g.name}`, [
      `\`/${g.key}\``,
      g.house_edge != null ? `edge ${(g.house_edge * 100).toFixed(2)}%` : 'fair draw',
    ])),
    footer: 'house edge disclosed per game • /lottery for the jackpot',
  });
}

export const casinoCommands = {
  casino: {
    data: new SlashCommandBuilder().setName('casino').setDescription('Casino hub: games, stats and fair seeds')
      .addSubcommand((s) => s.setName('games').setDescription('List every game'))
      .addSubcommand((s) => s.setName('stats').setDescription('Server casino statistics'))
      .addSubcommand((s) => s.setName('leaderboard').setDescription('Biggest casino players'))
      .addSubcommand((s) => s.setName('history').setDescription('Your recent bets'))
      .addSubcommand((s) => s.setName('seed').setDescription('Show or rotate your provably-fair seed')),
    async run({ guildId, userId, i }) {
      const sub = i.options.getSubcommand();
      if (sub === 'games') return { embeds: [gameEmbed()] };
      if (sub === 'stats') {
        const s = casinoStats(guildId);
        return {
          embeds: [embed('casino', {
            title: '📊  CASINO STATISTICS',
            description: [
              '━━━━━━━━━━━━━━━━━━━━',
              `BETS PLACED: **${num(s.bets)}**`,
              `TOTAL WAGERED: **${coin(s.wagered)}**`,
              `TOTAL PAID OUT: **${coin(s.payout)}**`,
              `HOUSE RESULT: ${s.house >= 0 ? '🟢' : '🔴'} **${coin(s.house)}**`,
              `WIN RATE: ${s.win_rate != null ? `${(s.win_rate * 100).toFixed(1)}%` : '—'}`,
              '━━━━━━━━━━━━━━━━━━━━',
              `BIGGEST WIN: ${coin(s.biggest_win)}`,
            ].join('\n'),
            footer: 'server-wide casino ledger',
          })],
        };
      }
      if (sub === 'leaderboard') {
        const rows = casinoLeaderboard(guildId, 10);
        return {
          embeds: [embed('casino', {
            title: '🏆  CASINO LEADERBOARD',
            description: rows.length
              ? rows.map((r, idx) => `${['🥇', '🥈', '🥉'][idx] || `\`${idx + 1}\``} <@${r.user_id}> — net **${coin(r.net)}** · ${num(r.bets)} bets`).join('\n')
              : 'No bets recorded yet.',
            footer: 'net result across all games',
          })],
        };
      }
      if (sub === 'history') {
        const rows = betHistory(guildId, userId, 12);
        return {
          embeds: [embed('casino', {
            title: '🧾  BET HISTORY',
            description: rows.length
              ? rows.map((b) => `• ${b.game} · ${coin(b.wager)} → ${coin(b.payout)} ${b.net >= 0 ? '🟢' : '🔴'} ${timeAgo(b.created_at)}`).join('\n')
              : 'No bets yet — try `/dice wager:100`.',
            footer: 'last 12 bets',
          })],
        };
      }
      const s = seedState(guildId, userId);
      const rotated = sub === 'seed' && i.options.getString('action') === 'rotate'
        ? rotateSeed(guildId, userId)
        : null;
      const state = rotated || s;
      return {
        embeds: [embed('casino', {
          title: '🔐  PROVABLY FAIR SEEDS',
          description: [
            '━━━━━━━━━━━━━━━━━━━━',
            `SERVER SEED HASH: \`${String(state.server_seed_hash || '').slice(0, 32)}\``,
            `CLIENT SEED: \`${state.client_seed || '—'}\``,
            `NONCE: ${num(state.nonce || 0)}`,
            '━━━━━━━━━━━━━━━━━━━━',
            'Outcomes derive from HMAC(server seed, client seed:nonce).',
            rotated ? '🔄 Seed pair rotated — previous server seed revealed above.' : '',
          ].filter(Boolean).join('\n'),
          footer: 'rotate anytime with /casino seed action:rotate',
        })],
      };
    },
  },

  crash: {
    data: new SlashCommandBuilder().setName('crash').setDescription('Crash — cash out before the curve busts')
      .addIntegerOption(WAGER)
      .addNumberOption((o) => o.setName('cashout').setDescription('Auto cash-out multiplier (default 2.00)').setMinValue(1.01).setMaxValue(1000)),
    async run({ guildId, userId, i }) {
      const res = playGame(guildId, userId, 'crash', i.options.getInteger('wager'), { autoCashout: i.options.getNumber('cashout') ?? 2 });
      if (!res.ok) return { embeds: [fail('BET REJECTED', errorText(res.reason))] };
      return { embeds: [settledEmbed(res, 'CRASH')] };
    },
  },

  roulette: {
    data: new SlashCommandBuilder().setName('roulette').setDescription('Roulette — red, black, green or a number')
      .addIntegerOption(WAGER)
      .addStringOption((o) => o.setName('bet').setDescription('red | black | green | 0-36').setRequired(true)),
    async run({ guildId, userId, i }) {
      const bet = String(i.options.getString('bet')).toLowerCase();
      const res = playGame(guildId, userId, 'roulette', i.options.getInteger('wager'), { bet });
      if (!res.ok) return { embeds: [fail('BET REJECTED', errorText(res.reason))] };
      return { embeds: [settledEmbed(res, 'ROULETTE')] };
    },
  },

  blackjack: {
    data: new SlashCommandBuilder().setName('blackjack').setDescription('Blackjack — one hand, dealer stands on 17')
      .addIntegerOption(WAGER),
    async run({ guildId, userId, i }) {
      const res = playGame(guildId, userId, 'blackjack', i.options.getInteger('wager'), {});
      if (!res.ok) return { embeds: [fail('BET REJECTED', errorText(res.reason))] };
      return { embeds: [settledEmbed(res, 'BLACKJACK')] };
    },
  },

  mines: {
    data: new SlashCommandBuilder().setName('mines').setDescription('Mines — reveal tiles, avoid the mines')
      .addIntegerOption(WAGER)
      .addIntegerOption((o) => o.setName('mines').setDescription('Mine count (default 3)').setMinValue(1).setMaxValue(20))
      .addIntegerOption((o) => o.setName('reveal').setDescription('Tiles to reveal (default 3)').setMinValue(1).setMaxValue(20)),
    async run({ guildId, userId, i }) {
      const res = playGame(guildId, userId, 'mines', i.options.getInteger('wager'), {
        mines: i.options.getInteger('mines') ?? 3,
        reveal: i.options.getInteger('reveal') ?? 3,
      });
      if (!res.ok) return { embeds: [fail('BET REJECTED', errorText(res.reason))] };
      return { embeds: [settledEmbed(res, 'MINES')] };
    },
  },

  slots: {
    data: new SlashCommandBuilder().setName('slots').setDescription('Slots — five reels, symbol payouts')
      .addIntegerOption(WAGER),
    async run({ guildId, userId, i }) {
      const res = playGame(guildId, userId, 'slots', i.options.getInteger('wager'), {});
      if (!res.ok) return { embeds: [fail('BET REJECTED', errorText(res.reason))] };
      return { embeds: [settledEmbed(res, 'SLOTS')] };
    },
  },

  dice: {
    data: new SlashCommandBuilder().setName('dice').setDescription('Dice — roll over or under a target')
      .addIntegerOption(WAGER)
      .addStringOption((o) => o.setName('direction').setDescription('over | under').addChoices({ name: 'over', value: 'over' }, { name: 'under', value: 'under' }))
      .addNumberOption((o) => o.setName('target').setDescription('Target 2-98 (default 50)').setMinValue(2).setMaxValue(98)),
    async run({ guildId, userId, i }) {
      const res = playGame(guildId, userId, 'dice', i.options.getInteger('wager'), {
        direction: i.options.getString('direction') || 'over',
        target: i.options.getNumber('target') ?? 50,
      });
      if (!res.ok) return { embeds: [fail('BET REJECTED', errorText(res.reason))] };
      return { embeds: [settledEmbed(res, 'DICE')] };
    },
  },

  coinflip: {
    data: new SlashCommandBuilder().setName('coinflip').setDescription('Coinflip — pick a side')
      .addIntegerOption(WAGER)
      .addStringOption((o) => o.setName('side').setDescription('heads | tails').addChoices({ name: 'heads', value: 'heads' }, { name: 'tails', value: 'tails' })),
    async run({ guildId, userId, i }) {
      const res = playGame(guildId, userId, 'coinflip', i.options.getInteger('wager'), { side: i.options.getString('side') || 'heads' });
      if (!res.ok) return { embeds: [fail('BET REJECTED', errorText(res.reason))] };
      return { embeds: [settledEmbed(res, 'COINFLIP')] };
    },
  },

  plinko: {
    data: new SlashCommandBuilder().setName('plinko').setDescription('Plinko — drop a ball through the peg field')
      .addIntegerOption(WAGER)
      .addStringOption((o) => o.setName('risk').setDescription('low | medium | high').addChoices(
        { name: 'low', value: 'low' }, { name: 'medium', value: 'medium' }, { name: 'high', value: 'high' },
      )),
    async run({ guildId, userId, i }) {
      const res = playGame(guildId, userId, 'plinko', i.options.getInteger('wager'), { risk: i.options.getString('risk') || 'medium' });
      if (!res.ok) return { embeds: [fail('BET REJECTED', errorText(res.reason))] };
      return { embeds: [settledEmbed(res, 'PLINKO')] };
    },
  },

  baccarat: {
    data: new SlashCommandBuilder().setName('baccarat').setDescription('Baccarat — player, banker or tie')
      .addIntegerOption(WAGER)
      .addStringOption((o) => o.setName('bet').setDescription('player | banker | tie').addChoices(
        { name: 'player', value: 'player' }, { name: 'banker', value: 'banker' }, { name: 'tie', value: 'tie' },
      )),
    async run({ guildId, userId, i }) {
      const res = playGame(guildId, userId, 'baccarat', i.options.getInteger('wager'), { bet: i.options.getString('bet') || 'player' });
      if (!res.ok) return { embeds: [fail('BET REJECTED', errorText(res.reason))] };
      return { embeds: [settledEmbed(res, 'BACCARAT')] };
    },
  },

  lottery: {
    data: new SlashCommandBuilder().setName('lottery').setDescription('Server lottery — buy tickets, one winner takes the pot')
      .addSubcommand((s) => s.setName('info').setDescription('Current round and pot'))
      .addSubcommand((s) => s.setName('buy').setDescription('Buy tickets')
        .addIntegerOption((o) => o.setName('tickets').setDescription('Ticket count').setMinValue(1).setMaxValue(20))),
    async run({ guildId, userId, i }) {
      if (i.options.getSubcommand() === 'buy') {
        const n = i.options.getInteger('tickets') || 1;
        const res = buyLotteryTicket(guildId, userId, n);
        if (!res.ok) return { embeds: [fail('TICKET REJECTED', errorText(res.reason))] };
        return {
          embeds: [ok('casino', 'TICKETS PURCHASED', [
            `Bought **${n}** ticket(s) for **${coin(n * LOTTERY_TICKET)}**.`,
            '',
            `POT: **${coin(res.round?.pot || 0)}**`,
            `YOUR TICKETS: **${num(res.tickets || n)}**`,
          ].join('\n'))],
        };
      }
      const round = currentLotteryRound(guildId);
      return {
        embeds: [embed('casino', {
          title: '🎟  SERVER LOTTERY',
          description: [
            '━━━━━━━━━━━━━━━━━━━━',
            `ROUND: **#${round.round_no || round.id || 1}**`,
            `POT: **${coin(round.pot || 0)}**`,
            `TICKET PRICE: ${coin(LOTTERY_TICKET)}`,
            `ENTRIES: ${num(round.entries || 0)}`,
            `DRAWS: ${round.draw_at ? timeAgo(round.draw_at) : 'when the round fills'}`,
            '━━━━━━━━━━━━━━━━━━━━',
            'One ticket, one chance. Winner takes the entire pot.',
          ].join('\n'),
          footer: 'buy with /lottery buy',
        })],
      };
    },
  },
};

export { gameEmbed };
