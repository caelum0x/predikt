import { CommandContext, Context } from 'grammy';
import { getMarketByTitle } from '../common';

/**
 * /market <query>
 *
 * Searches markets by title (substring, newest-first) and shows the market plus
 * its current prices. Mirrors herald's /market output.
 */
export async function market(ctx: CommandContext<Context>): Promise<void> {
  const query = ctx.match.trim();
  if (!query) {
    await ctx.reply('Usage: /market <search query>');
    return;
  }

  await ctx.reply(`Searching for "${query}"...`);
  const m = await getMarketByTitle(query);
  if (!m) {
    await ctx.reply(`No market matched "${query}".`);
    return;
  }

  const lines = [
    `Market: ${m.question}`,
    `ID: ${m.id}`,
    `Created by ${m.creatorName}`,
    `Closes at ${new Date(m.closeTime || 0).toLocaleString()}`,
    `URL: ${m.url}`,
    `Resolution: ${m.isResolved ? m.resolution : 'not resolved'}`,
  ];
  if (m.textDescription && m.textDescription.trim()) {
    lines.splice(1, 0, `Description: ${m.textDescription.trim()}`);
  }

  switch (m.outcomeType as string) {
    case 'BINARY':
      lines.push(`Odds: ${(m.probability * 100).toFixed(0)}% YES`);
      break;
    case 'FREE_RESPONSE':
      lines.push(
        `Answers: ${
          m.answers
            ?.map((a) => `"${a.text}" (${(a.probability * 100).toFixed(0)}%)`)
            .join(', ') || 'none'
        }`
      );
      break;
    default:
      lines.push(`${m.outcomeType} markets are not fully supported.`);
      break;
  }

  await ctx.reply(lines.join('\n'), { link_preview_options: { is_disabled: true } });
}
