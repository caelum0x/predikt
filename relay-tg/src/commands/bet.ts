import { CommandContext, Context } from 'grammy';
import { getClientForUser, getMarketByID } from '../common';

/**
 * /bet <amount> <marketId> <outcome>
 *
 * Places a real bet via POST /bet. For BINARY markets `outcome` is YES/NO; for
 * FREE_RESPONSE markets `outcome` is matched against answer text.
 * Mirrors herald's /bet logic.
 */
export async function bet(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Could not identify your Telegram account.');
    return;
  }

  const api = getClientForUser(ctx.from.id);
  if (!api) {
    await ctx.reply('You must first register your API key with /register <key>');
    return;
  }

  const parts = ctx.match.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) {
    await ctx.reply(
      'Usage: /bet <amount> <marketId> <outcome>\n' +
        'outcome is YES/NO for binary markets, or the answer text for free-response.\n' +
        'Use /market <query> to find a market ID.'
    );
    return;
  }

  const amount = Number(parts[0]);
  const marketId = parts[1];
  const outcomeArg = parts.slice(2).join(' ');

  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply('Amount must be a positive number.');
    return;
  }

  const market = await getMarketByID(marketId);
  if (!market) {
    await ctx.reply(`No market found with ID "${marketId}".`);
    return;
  }

  let outcome: string | undefined;
  if (market.outcomeType === 'BINARY') {
    const up = outcomeArg.toUpperCase();
    if (up !== 'YES' && up !== 'NO') {
      await ctx.reply('For binary markets, outcome must be YES or NO.');
      return;
    }
    outcome = up;
  } else if (market.outcomeType === 'FREE_RESPONSE') {
    outcome = market.answers?.find(
      (a) => a.text.toLowerCase().trim() === outcomeArg.toLowerCase().trim()
    )?.id;
    if (!outcome) {
      await ctx.reply(`Couldn't find an answer with text "${outcomeArg}".`);
      return;
    }
  } else {
    await ctx.reply(`${market.outcomeType} markets are not supported.`);
    return;
  }

  try {
    await api.createBet({ amount, contractId: market.id, outcome });
    await ctx.reply(`Bet ${amount} on ${outcomeArg} in "${market.question}"!`);
  } catch (e) {
    await ctx.reply(`Error placing bet: ${describeError(e)}`);
  }
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
