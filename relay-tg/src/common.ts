// Shared helpers: market cache, title search, and per-user client resolution.
//
// Ported from herald's common.ts. The market cache and search behaviour are the
// same; only the "who is the user" plumbing is swapped from Discord interactions
// to a plain Telegram user id.

import { createClient, FullMarket, LiteMarket, OracleClient } from './api';
import { oracleKeyMap } from './storage';

// Unauthenticated client for public market reads.
const api = createClient();

const marketsCache: {
  markets: LiteMarket[] | null;
  updateTime: number;
} = {
  markets: null,
  updateTime: 0,
};

const CACHE_TTL_MS = 1000 * 60; // 60 seconds, matching herald.

/**
 * Resolve an authenticated client for a Telegram user, or null if they have not
 * registered a key yet. The caller is expected to prompt them to /register.
 */
export function getClientForUser(telegramUserId: number | string): OracleClient | null {
  const key = oracleKeyMap[String(telegramUserId)];
  if (!key) return null;
  return createClient(key);
}

/**
 * All markets, newest-first, cached for 60s. On refresh we re-page from the top
 * and prepend anything newer than what we already have (herald's algorithm).
 */
export async function allMarkets(): Promise<LiteMarket[]> {
  if (marketsCache.markets && Date.now() - marketsCache.updateTime < CACHE_TTL_MS) {
    return marketsCache.markets;
  }

  if (!marketsCache.markets) {
    marketsCache.markets = await api.getAllMarkets();
    marketsCache.updateTime = Date.now();
    return marketsCache.markets;
  }

  const newestInCacheID = marketsCache.markets[0]?.id;
  infloop: for (;;) {
    const newest = await api.getMarkets({});
    if (!newest.length) break;
    for (const market of newest) {
      if (market.id === newestInCacheID) break infloop;
      marketsCache.markets.unshift(market);
    }
    if (!newestInCacheID) break;
  }

  marketsCache.updateTime = Date.now();
  return marketsCache.markets;
}

export async function getMarketByTitle(
  query: string,
  options?: { exact: boolean }
): Promise<FullMarket | null> {
  const q = query.toLowerCase().trim();
  for (const m of await allMarkets()) {
    if (options?.exact) {
      if (m.question.toLowerCase().trim() === q) return api.getMarket({ id: m.id });
    } else {
      if (m.question.toLowerCase().includes(q)) return api.getMarket({ id: m.id });
    }
  }
  return null;
}

export async function getMarketByID(id: string): Promise<FullMarket | null> {
  try {
    return await api.getMarket({ id });
  } catch (e) {
    return null;
  }
}
