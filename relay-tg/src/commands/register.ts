import { CommandContext, Context } from 'grammy';
import { createClient } from '../api';
import { oracleKeyMap, saveKeyMap } from '../storage';

/**
 * /register <api_key>
 *
 * Validates the key by calling GET /me against the real backend, then stores it
 * keyed by Telegram user id (mirrors herald's /register flow).
 */
export async function register(ctx: CommandContext<Context>): Promise<void> {
  const key = ctx.match.trim();
  if (!key) {
    await ctx.reply('Usage: /register <your Predikt API key>');
    return;
  }
  if (!ctx.from) {
    await ctx.reply('Could not identify your Telegram account.');
    return;
  }

  await ctx.reply('Checking API key...');

  try {
    const api = createClient(key);
    const me = await api.getMe();
    oracleKeyMap[String(ctx.from.id)] = key;
    saveKeyMap();
    await ctx.reply(`Registered Predikt account "${me.name}" to your Telegram account.`);
  } catch (e) {
    await ctx.reply(
      "Encountered an error using that API key to connect to Predikt — are you sure it's valid?"
    );
  }
}
