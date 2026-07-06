import fetch from 'node-fetch';

// Base URL is env-configurable so this bot can run against the Predikt/oracle
// backend (prod or dev) without a code change. Defaults to prod.
//   Prod: https://api.oracle.markets/v0   Dev: https://api.dev.oracle.markets/v0
const API_URL = process.env.ORACLE_API_URL || 'https://api.oracle.markets/v0';

// ---------------------------------------------------------------------------
// Types (ported from the manifold-sdk / liquify types the callers depend on)
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  createdTime: number;
  name: string; // display name, may contain spaces
  username: string;
  url?: string;
  avatarUrl?: string;
  balance: number;
  totalDeposits: number;
}

export interface Answer {
  createdTime: number;
  avatarUrl?: string;
  id: string;
  username?: string;
  number: number;
  name: string;
  contractId: string;
  text: string;
  userId: string;
  probability: number;
}

export type Fees = {
  liquidityFee: number;
  creatorFee: number;
  platformFee: number;
};

type LimitProps = {
  orderAmount: number;
  limitProb: number;
  isFilled: boolean;
  isCancelled: boolean;
  fills: Fill[];
};

export type Fill = {
  matchedBetId: string | null;
  amount: number;
  shares: number;
  timestamp: number;
  isSale?: boolean;
};

export type Bet = {
  id: string;
  userId: string;
  contractId: string;
  createdTime: number;

  amount: number;
  loanAmount?: number;
  outcome: string;
  shares: number;

  probBefore: number;
  probAfter: number;

  fees?: Fees;

  isSold?: boolean;
  isAnte?: boolean;
  isLiquidityProvision?: boolean;
  isRedemption?: boolean;
} & Partial<LimitProps>;

// Information about a market, but without bets, comments, or answers.
export interface LiteMarket {
  id: string;

  creatorUsername: string;
  creatorName: string;
  createdTime: number;
  creatorAvatarUrl?: string;

  closeTime?: number;
  question: string;
  description: unknown;
  textDescription?: string;
  slug?: string;

  tags: string[];
  url: string;

  outcomeType: 'BINARY' | 'FREE_RESPONSE' | 'NUMERIC' | string;
  mechanism: string;

  probability: number;
  pool: Record<string, number>;
  p?: number;
  totalLiquidity?: number;

  volume: number;
  volume7Days: number;
  volume24Hours: number;

  isResolved: boolean;
  resolutionTime?: number;
  resolution?: string;
  resolutionProbability?: number;
}

// A complete market, along with bets, comments, and answers.
export interface FullMarket extends LiteMarket {
  bets: Bet[];
  answers?: Answer[];
}

interface GenericCreateMarketArgs {
  question: string;
  description: string;
  closeTime: number;
  tags?: string[];
}

interface BinaryCreateMarketArgs extends GenericCreateMarketArgs {
  outcomeType: 'BINARY';
  initialProb: number;
}

interface FreeResponseCreateMarketArgs extends GenericCreateMarketArgs {
  outcomeType: 'FREE_RESPONSE';
}

interface NumericCreateMarketArgs extends GenericCreateMarketArgs {
  outcomeType: 'NUMERIC';
  min: number;
  max: number;
}

export type CreateMarketArgs =
  | BinaryCreateMarketArgs
  | FreeResponseCreateMarketArgs
  | NumericCreateMarketArgs;

export interface CreateMarketResponse extends LiteMarket {
  slug: string;
  creatorId?: string;
  initialProbability?: number;
}

// ---------------------------------------------------------------------------
// Error type + fetch helpers
// ---------------------------------------------------------------------------

export class OracleError extends Error {
  constructor(public statusCode: number, public errorResponse: unknown) {
    super(`[${statusCode}]: ${JSON.stringify(errorResponse, null, 2)}`);
    Object.setPrototypeOf(this, OracleError.prototype);
  }
}

const isEmpty = (obj: Record<string, unknown>) => Object.keys(obj).length === 0;

async function request<RetVal>(
  path: string,
  init: {
    method?: 'GET' | 'POST';
    params?: Record<string, string>;
    body?: unknown;
    apiKey?: string;
    requiresAuth?: boolean;
  } = {}
): Promise<RetVal> {
  const { method = 'GET', params, body, apiKey, requiresAuth = false } = init;

  if (requiresAuth && !apiKey) {
    throw new Error('Missing API Key');
  }

  const url = (() => {
    const pathname = `${API_URL}${path}`;
    if (!params || isEmpty(params)) return pathname;
    return `${pathname}?${new URLSearchParams(params).toString()}`;
  })();

  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Key ${apiKey}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const resp = await fetch(url, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  const contentType = resp.headers.get('content-type');
  if (!contentType || contentType.indexOf('application/json') === -1) {
    throw new Error(
      `Unexpectedly received non-JSON response: ${await resp.text()}`
    );
  }

  const json = await resp.json();
  if (!resp.ok) {
    throw new OracleError(resp.status, json);
  }
  return json as RetVal;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * A real fetch-based client for the Predikt/oracle backend.
 *
 * Drop-in replacement for the pieces of manifold-sdk's `Manifold`/`Oracle`
 * class that herald actually uses, but reads the host from `ORACLE_API_URL`
 * so it can reach the Predikt backend instead of the hardcoded manifold host.
 */
export class OracleClient {
  constructor(public apiKey?: string) {}

  // GET /me  (auth) -> User
  getMe(): Promise<User> {
    return request<User>('/me', { requiresAuth: true, apiKey: this.apiKey });
  }

  // GET /market/:id  or  GET /slug/:slug -> FullMarket
  getMarket({
    id,
    slug,
  }:
    | { id: string; slug?: never }
    | { id?: never; slug: string }): Promise<FullMarket> {
    if (id) return request<FullMarket>(`/market/${id}`);
    if (slug) return request<FullMarket>(`/slug/${slug}`);
    throw new Error('Need id or slug to fetch market');
  }

  // GET /markets?limit&before -> LiteMarket[]
  getMarkets({
    limit,
    before,
  }: { limit?: number; before?: string } = {}): Promise<LiteMarket[]> {
    const params: Record<string, string> = {
      ...(limit && { limit: limit.toString() }),
      ...(before && { before }),
    };
    return request<LiteMarket[]>('/markets', { params });
  }

  // Paginate through every market (newest first per page).
  async getAllMarkets(): Promise<LiteMarket[]> {
    const allMarkets: LiteMarket[] = [];
    let before: string | undefined = undefined;

    for (;;) {
      const markets = await this.getMarkets({ limit: 1000, before });
      allMarkets.push(...markets);
      if (markets.length < 1000) break;
      before = markets[markets.length - 1].id;
    }

    return allMarkets;
  }

  // POST /bet  (auth) -> Bet
  createBet(body: {
    amount: number;
    contractId: string;
    outcome: string;
    limitProb?: number;
  }): Promise<Bet> {
    return request<Bet>('/bet', {
      method: 'POST',
      body,
      requiresAuth: true,
      apiKey: this.apiKey,
    });
  }

  // POST /market  (auth) -> CreateMarketResponse
  createMarket({
    description,
    ...otherArgs
  }: CreateMarketArgs): Promise<CreateMarketResponse> {
    // The backend expects a rich-text doc for the description, matching the
    // manifold-sdk wire format.
    const body = {
      ...otherArgs,
      description: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: description }],
          },
        ],
      },
    };
    return request<CreateMarketResponse>('/market', {
      method: 'POST',
      body,
      requiresAuth: true,
      apiKey: this.apiKey,
    });
  }
}

/**
 * Factory that replaces the old `new Oracle(apiKey)` usage. Reads `ORACLE_API_KEY` from the
 * environment when no key is passed (used for unauthenticated market reads).
 */
export function createClient(apiKey?: string): OracleClient {
  return new OracleClient(apiKey ?? process.env.ORACLE_API_KEY);
}
