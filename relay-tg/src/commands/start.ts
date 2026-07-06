import { CommandContext, Context } from 'grammy';

const HELP = [
  'Predikt on Telegram — companion to the Discord bot (herald).',
  '',
  'Commands:',
  '/register <api_key> — link your Predikt/oracle API key (do this first)',
  '/market <query> — look up a market and its prices',
  '/bet <amount> <marketId> <outcome> — place a bet (outcome: YES/NO or a free-response choice)',
  '/create <type> | <question> | <description> | <closes YYYY-MM-DD> [| <extra>] — create a market',
  '/portfolio — your balance and open positions',
  '',
  'Get your API key from your Predikt account settings, then run /register.',
].join('\n');

export async function start(ctx: CommandContext<Context>): Promise<void> {
  await ctx.reply(HELP);
}
