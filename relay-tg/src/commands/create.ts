import { CommandContext, Context } from 'grammy';
import { CreateMarketArgs } from '../api';
import { getClientForUser } from '../common';

/**
 * /create <type> | <question> | <description> | <closes YYYY-MM-DD> [| <extra>]
 *
 * type is BINARY, FREE_RESPONSE, or NUMERIC.
 *   - BINARY:  extra = initial probability 1..99 (optional, default 50)
 *   - NUMERIC: extra = "<min> <max>" (required)
 *   - FREE_RESPONSE: no extra
 *
 * Pipe-delimited because Telegram has no typed slash options like Discord.
 * Mirrors herald's /create validation and POST /market call.
 */
export async function create(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('Could not identify your Telegram account.');
    return;
  }

  const api = getClientForUser(ctx.from.id);
  if (!api) {
    await ctx.reply('You must first register your API key with /register <key>');
    return;
  }

  const fields = ctx.match.split('|').map((s) => s.trim());
  if (fields.length < 4) {
    await ctx.reply(
      'Usage: /create <type> | <question> | <description> | <closes YYYY-MM-DD> [| <extra>]\n' +
        'type: BINARY, FREE_RESPONSE, or NUMERIC.\n' +
        'extra: BINARY -> initial probability (1-99); NUMERIC -> "<min> <max>".'
    );
    return;
  }

  const [typeRaw, question, description, closes, extra] = fields;
  const type = typeRaw.toUpperCase() as 'BINARY' | 'FREE_RESPONSE' | 'NUMERIC';
  if (type !== 'BINARY' && type !== 'FREE_RESPONSE' && type !== 'NUMERIC') {
    await ctx.reply('type must be BINARY, FREE_RESPONSE, or NUMERIC.');
    return;
  }

  const closeTime = new Date(closes).getTime();
  if (!closeTime || closeTime < Date.now()) {
    await ctx.reply('You must specify a valid future closing date (YYYY-MM-DD).');
    return;
  }

  const base = { question, description, closeTime };
  let args: CreateMarketArgs;

  if (type === 'BINARY') {
    const initialProb = extra ? Number(extra) : 50;
    if (!Number.isFinite(initialProb) || initialProb < 1 || initialProb > 99) {
      await ctx.reply('Initial probability must be a number from 1 to 99.');
      return;
    }
    args = { ...base, outcomeType: 'BINARY', initialProb };
  } else if (type === 'NUMERIC') {
    const nums = (extra || '').split(/\s+/).map(Number);
    const [min, max] = nums;
    if (nums.length !== 2 || !Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      await ctx.reply('For NUMERIC markets, extra must be "<min> <max>" with min < max.');
      return;
    }
    args = { ...base, outcomeType: 'NUMERIC', min, max };
  } else {
    args = { ...base, outcomeType: 'FREE_RESPONSE' };
  }

  await ctx.reply('Creating market...');
  try {
    const market = await api.createMarket(args);
    await ctx.reply(
      `Created "${market.question}" (ID ${market.id}).\n${market.url}`,
      { link_preview_options: { is_disabled: true } }
    );
  } catch (e) {
    await ctx.reply(`Error creating market: ${e instanceof Error ? e.message : String(e)}`);
  }
}
