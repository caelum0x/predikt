import { CommandContext, Context } from 'grammy';
import { Bet } from '../api';
import { getClientForUser, getMarketByID } from '../common';

/**
 * /portfolio
 *
 * Shows the registered user's balance (GET /me) and aggregates their bets
 * (GET /bets?userId=...) into per-market net share positions. Real API calls only.
 */
export async function portfolio(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Could not identify your Telegram account.');
    return;
  }

  const api = getClientForUser(ctx.from.id);
  if (!api) {
    await ctx.reply('You must first register your API key with /register <key>');
    return;
  }

  await ctx.reply('Loading your portfolio...');

  try {
    const me = await api.getMe();
    const bets = await api.getBets({ userId: me.id, limit: 1000 });

    if (!bets.length) {
      await ctx.reply(
        `Account: ${me.name}\nBalance: ${me.balance.toFixed(0)}\nNo positions yet.`
      );
      return;
    }

    const positions = aggregatePositions(bets);
    const marketIds = Object.keys(positions).slice(0, 15); // cap message size

    const questions = await Promise.all(
      marketIds.map(async (id) => (await getMarketByID(id))?.question ?? id)
    );

    const lines = [
      `Account: ${me.name}`,
      `Balance: ${me.balance.toFixed(0)}`,
      '',
      'Positions:',
    ];
    marketIds.forEach((id, i) => {
      const p = positions[id];
      const perOutcome = Object.entries(p)
        .filter(([, shares]) => Math.abs(shares) > 1e-6)
        .map(([outcome, shares]) => `${outcome}: ${shares.toFixed(1)} shares`)
        .join(', ');
      if (perOutcome) lines.push(`- ${questions[i]} — ${perOutcome}`);
    });

    if (Object.keys(positions).length > marketIds.length) {
      lines.push(`...and ${Object.keys(positions).length - marketIds.length} more.`);
    }

    await ctx.reply(lines.join('\n'), { link_preview_options: { is_disabled: true } });
  } catch (e) {
    await ctx.reply(`Error loading portfolio: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Net shares per outcome, grouped by market (contractId). */
function aggregatePositions(bets: Bet[]): Record<string, Record<string, number>> {
  const byMarket: Record<string, Record<string, number>> = {};
  for (const b of bets) {
    if (b.isRedemption) continue;
    const market = (byMarket[b.contractId] ||= {});
    market[b.outcome] = (market[b.outcome] || 0) + (b.shares || 0);
  }
  return byMarket;
}
