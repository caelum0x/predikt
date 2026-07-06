// Predikt Telegram bot — companion to the Discord bot (herald).
//
// Real Telegram Bot API via grammY (MIT), real backend calls via the shared
// OracleClient (ORACLE_API_URL). No mocks.

import 'dotenv/config';
import { Bot } from 'grammy';

import { start } from './commands/start';
import { register } from './commands/register';
import { market } from './commands/market';
import { bet } from './commands/bet';
import { create } from './commands/create';
import { portfolio } from './commands/portfolio';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN is not set — provide it as an environment variable or in .env');
  process.exit(1);
}

const bot = new Bot(token);

// Command handlers. grammY exposes the argument string after the command as
// ctx.match, which each handler parses itself.
bot.command('start', start);
bot.command('help', start);
bot.command('register', register);
bot.command('market', market);
bot.command('bet', bet);
bot.command('create', create);
bot.command('portfolio', portfolio);

// Register the command list so Telegram shows them in the "/" menu.
bot.api
  .setMyCommands([
    { command: 'start', description: 'Show help and available commands' },
    { command: 'register', description: 'Link your Predikt API key' },
    { command: 'market', description: 'Look up a market and its prices' },
    { command: 'bet', description: 'Place a bet in a market' },
    { command: 'create', description: 'Create a new market' },
    { command: 'portfolio', description: 'Show your balance and positions' },
  ])
  .catch((e) => console.error('Failed to set command menu:', e));

// Global error handler so one failing update never crashes the bot.
bot.catch((err) => {
  console.error(`Error handling update ${err.ctx.update.update_id}:`, err.error);
});

console.log('Starting Predikt Telegram bot...');
bot.start({
  onStart: (info) => console.log(`Logged in as @${info.username}`),
});
