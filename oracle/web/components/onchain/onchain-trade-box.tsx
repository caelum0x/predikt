import { CubeIcon } from '@heroicons/react/solid'
import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { formatUnits, parseUnits } from 'viem'
import { Button } from 'web/components/buttons/button'
import { Col } from 'web/components/layout/col'
import { Row } from 'web/components/layout/row'
import { Input } from 'web/components/widgets/input'
import { useOnchainWallet } from 'web/hooks/use-onchain-wallet'
import { USDC_DECIMALS } from 'web/lib/onchain/addresses'
import { PRIMARY_CHAIN_KEY } from 'web/lib/onchain/chains'
import {
  ConditionId,
  derivePositionIds,
  mergePositions,
  OnchainMarketState,
  readMarketState,
  readUserPosition,
  redeem,
  splitPosition,
} from 'web/lib/onchain/market'
import {
  bestAsk,
  bestBid,
  buildBuyLimitOrder,
  buildSellLimitOrder,
  getBook,
  isRelayTradingEnabled,
  RelayError,
  RelayUnavailableError,
  submitOrder,
  type RelayBook,
  type SignedOrder,
} from 'web/lib/onchain/orders'
import { isAmmEnabled } from 'web/lib/onchain/amm'
import {
  routeBestExecution,
  type BestExecution,
  type Venue,
} from 'web/lib/onchain/router'
import { unlock } from 'web/lib/onchain/wallet'
import { ConnectWalletSheet } from './connect-wallet-sheet'
import { OnchainOrderBook } from './onchain-order-book'

type Outcome = 'YES' | 'NO'
type OrderMode = 'MARKET' | 'LIMIT'
type TradeSide = 'BUY' | 'SELL'
type AdvancedAction = 'split' | 'merge'

/**
 * Describes an in-flight submission for optimistic UI feedback. `label` is the
 * confirming-state button text; `detail` is a human summary of the intended
 * position/USDC delta shown while the real tx confirms. Purely presentational —
 * the underlying on-chain tx is real and authoritative; on success/error we
 * reconcile against the actual chain state.
 */
interface PendingAction {
  label: string
  detail: string
}

function fmt(n: bigint | null | undefined): string {
  if (n == null) return '—'
  return formatUnits(n, USDC_DECIMALS)
}

/** Human shares (6-dp base units) as a trimmed decimal string. */
function shares(n: bigint | null | undefined): string {
  if (n == null) return '—'
  const s = formatUnits(n, USDC_DECIMALS)
  return s.replace(/\.?0+$/, '') || '0'
}

/**
 * Polymarket-style trading box for on-chain (crypto) markets.
 *
 * REAL flow, best-execution routed:
 *   - MARKET · BUY/SELL : the router (lib/onchain/router.ts) quotes BOTH the
 *     AMM (Predikt's FPMM `calcBuyAmount`/`calcSellAmount`) and the CLOB order
 *     book (relay `GET /book`), picks whichever gives the trader more (more
 *     outcome tokens for a BUY spend, more USDC for a SELL), shows the effective
 *     price + winning venue, then executes it — a real AMM `buy`/`sell` tx
 *     (approve first) or a real signed EIP-712 CTFExchange order submitted to the
 *     relay. This makes markets instantly tradeable even with an EMPTY book: the
 *     AMM always provides a quote when a funded pool exists.
 *   - LIMIT · BUY/SELL (Advanced): the CLOB path only — buildBuy/SellLimitOrder
 *     signs an EIP-712 order that rests / crosses on the relay book.
 *   - Mint / merge / redeem (Advanced): split USDC into a YES+NO set, merge it
 *     back, or redeem winners after resolution — all direct CTF txs.
 *
 * No fabricated prices: AMM quotes are live on-chain view calls; CLOB quotes
 * walk the real resting depth. When NEITHER venue can price a trade the box
 * shows a graceful "no liquidity" state and points at Advanced (mint/redeem).
 *
 * Venue availability (all optional, resolved from NEXT_PUBLIC_* env):
 *   - CLOB : NEXT_PUBLIC_ONCHAIN_RELAY_URL set (relay reachable).
 *   - AMM  : NEXT_PUBLIC_ONCHAIN_FPMM_FACTORY set (a funded pool exists).
 * When both are unset the box falls back to mint/merge/redeem only. Off-chain
 * (play-money) markets keep the standard panel — this renders only on-chain.
 */
export function OnchainTradeBox(props: {
  conditionId: ConditionId
  className?: string
}) {
  const { conditionId, className } = props
  const wallet = useOnchainWallet()

  const relayEnabled = useMemo(() => isRelayTradingEnabled(), [])
  const ammEnabled = useMemo(() => isAmmEnabled(), [])
  // Trading (the YES/NO + BUY/SELL panel) is available when EITHER venue can
  // execute: the CLOB relay, the AMM, or both. When neither is configured we
  // fall back to the mint/merge/redeem-only panel (never a fabricated fill).
  const tradingEnabled = relayEnabled || ammEnabled

  const [state, setState] = useState<OnchainMarketState | null>(null)
  const [position, setPosition] = useState<{ yes: bigint; no: bigint } | null>(
    null
  )
  const [tokenIds, setTokenIds] = useState<{ yes: string; no: string } | null>(
    null
  )
  const [book, setBook] = useState<RelayBook | null>(null)

  const [outcome, setOutcome] = useState<Outcome>('YES')
  const [mode, setMode] = useState<OrderMode>('MARKET')
  const [side, setSide] = useState<TradeSide>('BUY')
  const [amount, setAmount] = useState('')
  const [limitPriceCents, setLimitPriceCents] = useState('')

  const [advanced, setAdvanced] = useState<AdvancedAction>('split')
  const [advancedAmount, setAdvancedAmount] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [busy, setBusy] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)

  // Optimistic in-flight state. The on-chain tx is still REAL — this only drives
  // immediate UI feedback while the RPC/relay confirms, so the box never looks
  // frozen. It is set the instant a submit starts, and reconciled (cleared) on
  // success or error. `delta` is the intended position/USDC change we surface
  // optimistically; on failure we simply drop it (revert) and toast the error.
  const [pending, setPending] = useState<PendingAction | null>(null)

  // Best-execution route for the current MARKET inputs (null until quoted).
  const [route, setRoute] = useState<BestExecution | null>(null)
  const [quoting, setQuoting] = useState(false)

  const loadState = useCallback(async () => {
    try {
      setState(await readMarketState(conditionId))
    } catch {
      // Non-fatal; leave prior state.
    }
  }, [conditionId])

  const loadTokenIds = useCallback(async () => {
    try {
      const [yes, no] = await derivePositionIds(conditionId)
      setTokenIds({ yes: yes.toString(), no: no.toString() })
    } catch {
      setTokenIds(null)
    }
  }, [conditionId])

  const loadPosition = useCallback(async () => {
    if (!wallet.address) {
      setPosition(null)
      return
    }
    try {
      setPosition(await readUserPosition(conditionId, wallet.address))
    } catch {
      setPosition(null)
    }
  }, [conditionId, wallet.address])

  const activeTokenId = tokenIds
    ? outcome === 'YES'
      ? tokenIds.yes
      : tokenIds.no
    : null

  const loadBook = useCallback(async () => {
    if (!relayEnabled || !activeTokenId) return
    try {
      setBook(await getBook(activeTokenId))
    } catch {
      // Relay may be briefly unreachable; keep prior book.
    }
  }, [relayEnabled, activeTokenId])

  useEffect(() => {
    loadState()
    loadTokenIds()
  }, [loadState, loadTokenIds])

  useEffect(() => {
    loadPosition()
  }, [loadPosition])

  useEffect(() => {
    loadBook()
  }, [loadBook])

  // LIMIT orders are a CLOB-only feature. If the relay is off (AMM-only
  // deployment), keep the box on MARKET so there's no dead LIMIT tab.
  useEffect(() => {
    if (!relayEnabled && mode === 'LIMIT') setMode('MARKET')
  }, [relayEnabled, mode])

  // Post-action reconcile: always FORCE the wallet balance read (bypassing the
  // hook's interval guard) because a trade/mint/redeem just changed on-chain
  // state and the UI must reflect the freshest USDC + position immediately.
  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadState(),
      loadPosition(),
      loadBook(),
      wallet.refresh({ force: true }),
    ])
  }, [loadState, loadPosition, loadBook, wallet])

  // Live best-execution quote for MARKET orders: quote BOTH venues (AMM + CLOB)
  // and keep the winner in `route`. Debounced; race-guarded so only the latest
  // input wins. LIMIT orders stay on the pure CLOB path and skip this.
  useEffect(() => {
    if (mode !== 'MARKET') {
      setRoute(null)
      return
    }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setRoute(null)
      return
    }
    let cancelled = false
    setQuoting(true)
    const handle = setTimeout(async () => {
      try {
        const r = await routeBestExecution(
          { conditionId, outcome, side, amount: amt },
          book,
          activeTokenId
        )
        if (!cancelled) setRoute(r)
      } catch {
        if (!cancelled) setRoute(null)
      } finally {
        if (!cancelled) setQuoting(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [mode, amount, outcome, side, conditionId, book, activeTokenId])

  const resolved = state?.resolved ?? false
  const yesPrice = state ? Math.round(state.prices[0] * 100) : 50
  const noPrice = state ? 100 - yesPrice : 50
  const outcomePrice = outcome === 'YES' ? yesPrice : noPrice

  // Best book prices for the active outcome (in [0,1]); used to bound market
  // orders and to show a live average price / payout estimate.
  const bookBestAsk = book ? bestAsk(book) : null
  const bookBestBid = book ? bestBid(book) : null

  /** The reference price used for market-order bounding + payout math. */
  const refPrice = useMemo(() => {
    if (side === 'BUY') {
      return bookBestAsk ?? outcomePrice / 100
    }
    return bookBestBid ?? outcomePrice / 100
  }, [side, bookBestAsk, bookBestBid, outcomePrice])

  const limitPrice = useMemo(() => {
    const cents = Number(limitPriceCents)
    if (!Number.isFinite(cents)) return null
    return cents / 100
  }, [limitPriceCents])

  // Live estimate: for a BUY, shares ≈ amount / price and payout = shares * $1;
  // for a SELL, proceeds ≈ shares * price.
  const estimate = useMemo(() => {
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) return null
    const price = mode === 'LIMIT' ? limitPrice ?? refPrice : refPrice
    if (!price || price <= 0 || price >= 1) return null
    if (side === 'BUY') {
      const sh = amt / price
      return { label: 'Est. shares', value: sh, payout: sh, avg: price }
    }
    return { label: 'Est. proceeds', value: amt * price, payout: null, avg: price }
  }, [amount, mode, limitPrice, refPrice, side])

  /** MARKET order: route to the best venue (AMM vs CLOB) and execute it. */
  const placeMarketOrder = async () => {
    if (!route || route.venue === 'none' || !route.quote) {
      toast.error('No venue can execute this trade right now')
      return
    }
    // Optimistic feedback: reflect the intended fill immediately. Numbers come
    // from the REAL router quote — we're not fabricating a result, just showing
    // the trade we're about to send while it confirms.
    const q = route.quote
    const shs = q.outcomeTokens ? Number(q.outcomeTokens) / 1e6 : 0
    const usd = q.usdc ? Number(q.usdc) / 1e6 : 0
    setPending({
      label: side === 'BUY' ? 'Confirming buy…' : 'Confirming sell…',
      detail:
        side === 'BUY'
          ? `+${shs.toFixed(2)} ${outcome} shares (−$${usd.toFixed(2)})`
          : `+$${usd.toFixed(2)} (−${shs.toFixed(2)} ${outcome} shares)`,
    })
    setBusy(true)
    try {
      const result = await route.execute()
      if (result.venue === 'AMM') {
        toast.success(
          side === 'BUY'
            ? 'Bought via AMM — tx sent'
            : 'Sold via AMM — tx sent'
        )
      } else {
        const r = result.relay
        if (r.matched && r.fills.length > 0) {
          toast.success(
            r.status === 'FILLED'
              ? 'Filled on the order book'
              : 'Partially filled — remainder resting'
          )
        } else if (r.status === 'OPEN') {
          toast.success('Order signed + resting on the book')
        } else {
          toast.success(`Order ${r.status.toLowerCase()}`)
        }
      }
      setAmount('')
      setRoute(null)
      await refreshAll()
    } catch (e) {
      if (e instanceof RelayUnavailableError) {
        toast.error('Relay unavailable — try Advanced (mint/redeem) below')
      } else if (e instanceof RelayError) {
        toast.error(e.message)
      } else {
        toast.error(e instanceof Error ? e.message : 'Trade failed')
      }
    } finally {
      // Reconcile: drop the optimistic state whether we succeeded (real result
      // is now loaded via refreshAll) or failed (revert + error already toasted).
      setPending(null)
      setBusy(false)
    }
  }

  /** LIMIT order: pure CLOB path (signed EIP-712 order to the relay). */
  const placeLimitOrder = async () => {
    if (!activeTokenId) {
      toast.error('Market not ready yet')
      return
    }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter an amount')
      return
    }
    const price = limitPrice
    if (price == null || price <= 0 || price >= 1) {
      toast.error('Enter a limit price between 1 and 99 cents')
      return
    }

    // Optimistic feedback for the signed limit order (real EIP-712 submit).
    setPending({
      label: side === 'BUY' ? 'Confirming buy…' : 'Confirming sell…',
      detail:
        side === 'BUY'
          ? `${amt.toFixed(2)} ${outcome} @ ${(price * 100).toFixed(0)}¢`
          : `Sell ${amt.toFixed(2)} ${outcome} @ ${(price * 100).toFixed(0)}¢`,
    })
    setBusy(true)
    try {
      const w = await unlock()
      const walletClient = w.walletClient(PRIMARY_CHAIN_KEY)
      const base = {
        wallet: walletClient,
        walletAddress: w.address,
        tokenId: activeTokenId,
      }
      const order: SignedOrder =
        side === 'BUY'
          ? await buildBuyLimitOrder({ ...base, price, size: amt })
          : await buildSellLimitOrder({ ...base, price, size: amt })

      const result = await submitOrder(order)
      if (result.matched && result.fills.length > 0) {
        toast.success(
          result.status === 'FILLED'
            ? 'Order filled on-chain'
            : 'Order partially filled — remainder resting'
        )
      } else if (result.status === 'OPEN') {
        toast.success('Order signed + resting on the book')
      } else {
        toast.success(`Order ${result.status.toLowerCase()}`)
      }
      setAmount('')
      await refreshAll()
    } catch (e) {
      if (e instanceof RelayUnavailableError) {
        toast.error('Relay unavailable — try Advanced (mint/redeem) below')
      } else if (e instanceof RelayError) {
        toast.error(e.message)
      } else {
        toast.error(e instanceof Error ? e.message : 'Order failed')
      }
    } finally {
      setPending(null)
      setBusy(false)
    }
  }

  const placeOrder = async () => {
    if (!wallet.address) {
      setWalletOpen(true)
      return
    }
    if (mode === 'MARKET') {
      await placeMarketOrder()
    } else {
      await placeLimitOrder()
    }
  }

  const onAdvanced = async () => {
    if (!wallet.address) {
      setWalletOpen(true)
      return
    }
    let wei: bigint
    try {
      wei = parseUnits(advancedAmount || '0', USDC_DECIMALS)
    } catch {
      toast.error('Enter a valid amount')
      return
    }
    if (wei <= 0n) {
      toast.error('Enter an amount')
      return
    }
    const human = formatUnits(wei, USDC_DECIMALS)
    setPending(
      advanced === 'split'
        ? { label: 'Confirming mint…', detail: `+${human} YES + ${human} NO` }
        : { label: 'Confirming merge…', detail: `−${human} YES + NO → +$${human}` }
    )
    setBusy(true)
    try {
      if (advanced === 'split') {
        await splitPosition(conditionId, wei)
        toast.success('Minted YES + NO shares — tx sent')
      } else {
        await mergePositions(conditionId, wei)
        toast.success('Merged shares back to USDC — tx sent')
      }
      setAdvancedAmount('')
      await refreshAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Transaction failed')
    } finally {
      setPending(null)
      setBusy(false)
    }
  }

  const onRedeem = async () => {
    if (!wallet.address) {
      setWalletOpen(true)
      return
    }
    setPending({ label: 'Confirming redeem…', detail: 'Paying out winning shares' })
    setBusy(true)
    try {
      await redeem(conditionId)
      toast.success('Redeemed — USDC paid out')
      await refreshAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Redeem failed')
    } finally {
      setPending(null)
      setBusy(false)
    }
  }

  const outcomePosition =
    position && (outcome === 'YES' ? position.yes : position.no)

  return (
    <Col className="w-full gap-3">
      <Col
        className={clsx(
          'border-ink-200 bg-canvas-0 gap-3 rounded-lg border p-4',
          className
        )}
      >
        <Row className="items-center justify-between">
          <Row className="text-primary-700 items-center gap-1.5 text-sm font-semibold">
            <CubeIcon className="h-4 w-4" />
            <span>Crypto · USDC</span>
          </Row>
          <button
            className="text-primary-600 text-xs font-semibold hover:underline"
            onClick={() => setWalletOpen(true)}
          >
            {wallet.address ? `${fmt(wallet.usdc)} USDC` : 'Connect wallet'}
          </button>
        </Row>

        {resolved ? (
          <Col className="gap-3">
            <span className="text-ink-700 text-sm">
              This market has resolved. Redeem your winning shares for USDC.
            </span>
            <Row className="text-ink-600 gap-4 text-sm">
              <span>YES shares: {shares(position?.yes)}</span>
              <span>NO shares: {shares(position?.no)}</span>
            </Row>
            {pending && <PendingBanner pending={pending} />}
            <Button
              color="blue"
              size="lg"
              loading={busy}
              disabled={!!pending}
              onClick={onRedeem}
            >
              {pending ? pending.label : 'Redeem USDC'}
            </Button>
          </Col>
        ) : tradingEnabled ? (
          <Col className="gap-3">
            {/* YES / NO segmented */}
            <Row className="gap-2">
              <OutcomeChip
                color="teal"
                label="YES"
                price={yesPrice}
                active={outcome === 'YES'}
                onClick={() => setOutcome('YES')}
              />
              <OutcomeChip
                color="scarlet"
                label="NO"
                price={noPrice}
                active={outcome === 'NO'}
                onClick={() => setOutcome('NO')}
              />
            </Row>

            {/* BUY / SELL */}
            <Row className="bg-canvas-50 rounded-md p-0.5">
              <SegTab active={side === 'BUY'} onClick={() => setSide('BUY')}>
                Buy
              </SegTab>
              <SegTab active={side === 'SELL'} onClick={() => setSide('SELL')}>
                Sell
              </SegTab>
            </Row>

            {/* MARKET / LIMIT — LIMIT is CLOB-only, shown when the relay is on. */}
            {relayEnabled && (
              <Row className="bg-canvas-50 rounded-md p-0.5">
                <SegTab
                  active={mode === 'MARKET'}
                  onClick={() => setMode('MARKET')}
                >
                  Market
                </SegTab>
                <SegTab
                  active={mode === 'LIMIT'}
                  onClick={() => setMode('LIMIT')}
                >
                  Limit
                </SegTab>
              </Row>
            )}

            {mode === 'LIMIT' && (
              <Col className="gap-1">
                <label
                  htmlFor="onchain-limit-price"
                  className="text-ink-500 text-xs"
                >
                  Limit price (cents, 1–99)
                </label>
                <Input
                  id="onchain-limit-price"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  step="1"
                  value={limitPriceCents}
                  onChange={(e) => setLimitPriceCents(e.target.value)}
                  placeholder={`${outcomePrice}`}
                />
              </Col>
            )}

            <Col className="gap-1">
              <label className="text-ink-500 text-xs">
                {side === 'BUY'
                  ? mode === 'MARKET'
                    ? `Spend (USDC) on ${outcome}`
                    : `Shares of ${outcome} to buy`
                  : `Shares of ${outcome} to sell`}
              </label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </Col>

            {/* MARKET: real best-execution route (AMM vs CLOB) from the router. */}
            {mode === 'MARKET' ? (
              <RoutePanel
                route={route}
                quoting={quoting}
                side={side}
                outcome={outcome}
                hasAmount={Number(amount) > 0}
              />
            ) : (
              <>
                {estimate && (
                  <Row className="text-ink-500 justify-between text-xs">
                    <span>
                      {estimate.label}: {estimate.value.toFixed(2)}
                    </span>
                    <span>Avg: {(estimate.avg * 100).toFixed(1)}¢</span>
                  </Row>
                )}
                {estimate?.payout != null && (
                  <Row className="text-ink-500 text-xs">
                    <span>
                      Payout if {outcome} wins: ${estimate.payout.toFixed(2)}
                    </span>
                  </Row>
                )}
              </>
            )}

            {wallet.address && position && (
              <Row className="text-ink-500 gap-4 text-xs">
                <span>Your {outcome}: {shares(outcomePosition)}</span>
              </Row>
            )}

            {pending && <PendingBanner pending={pending} />}

            <Button
              color="blue"
              size="lg"
              loading={busy || (mode === 'MARKET' && quoting)}
              disabled={
                !!pending ||
                (mode === 'MARKET' &&
                  !!wallet.address &&
                  Number(amount) > 0 &&
                  !quoting &&
                  (!route || route.venue === 'none'))
              }
              onClick={placeOrder}
            >
              {pending
                ? pending.label
                : marketButtonLabel({
                    connected: !!wallet.address,
                    mode,
                    side,
                    outcome,
                    route,
                    quoting,
                    hasAmount: Number(amount) > 0,
                  })}
            </Button>

            <button
              className="text-ink-400 self-center text-xs hover:underline"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? 'Hide advanced' : 'Advanced (mint / redeem set)'}
            </button>

            {showAdvanced && (
              <AdvancedPanel
                advanced={advanced}
                setAdvanced={setAdvanced}
                amount={advancedAmount}
                setAmount={setAdvancedAmount}
                busy={busy}
                onSubmit={onAdvanced}
                connected={!!wallet.address}
                pending={pending}
              />
            )}
          </Col>
        ) : (
          // Fallback: no relay/env — mint/merge/redeem only, never a fake fill.
          <Col className="gap-3">
            <span className="text-ink-500 text-xs">
              Order trading is offline. You can still mint or redeem full YES+NO
              sets directly on-chain.
            </span>
            <Row className="gap-2">
              <OutcomeChip color="teal" label="YES" price={yesPrice} />
              <OutcomeChip color="scarlet" label="NO" price={noPrice} />
            </Row>
            <AdvancedPanel
              advanced={advanced}
              setAdvanced={setAdvanced}
              amount={advancedAmount}
              setAmount={setAdvancedAmount}
              busy={busy}
              onSubmit={onAdvanced}
              connected={!!wallet.address}
              pending={pending}
            />
          </Col>
        )}

        <ConnectWalletSheet
          open={walletOpen}
          setOpen={setWalletOpen}
          wallet={wallet}
        />
      </Col>

      {relayEnabled && activeTokenId && !resolved && (
        <OnchainOrderBook
          tokenId={activeTokenId}
          outcome={outcome}
          book={book}
        />
      )}
    </Col>
  )
}

/** Friendly label for a venue chip. */
function venueLabel(venue: Venue): string {
  if (venue === 'AMM') return 'AMM (instant)'
  if (venue === 'CLOB') return 'Order book'
  return '—'
}

/**
 * Shows the REAL best-execution route for a MARKET order: which venue won, the
 * effective average price, and the estimated shares / proceeds. Every number
 * here comes from the router's real quotes (AMM view calls + simulated CLOB
 * depth) — nothing is faked. Renders graceful states while quoting and when no
 * venue can price the trade.
 */
function RoutePanel(props: {
  route: BestExecution | null
  quoting: boolean
  side: TradeSide
  outcome: Outcome
  hasAmount: boolean
}) {
  const { route, quoting, side, outcome, hasAmount } = props

  if (!hasAmount) return null
  if (quoting && !route) {
    return (
      <span className="text-ink-400 text-xs">Finding best price…</span>
    )
  }
  if (!route || route.venue === 'none' || !route.quote) {
    return (
      <span className="text-ink-500 text-xs">
        No liquidity to price this trade right now. Try Advanced (mint / redeem)
        below, or a smaller size.
      </span>
    )
  }

  const q = route.quote
  const avgCents = (q.avgPrice * 100).toFixed(1)
  const shares = q.outcomeTokens ? Number(q.outcomeTokens) / 1e6 : 0
  const usdc = q.usdc ? Number(q.usdc) / 1e6 : 0
  const other = route.venue === 'AMM' ? route.quotes.clob : route.quotes.amm

  return (
    <Col className="border-ink-100 gap-1 rounded-md border p-2 text-xs">
      <Row className="items-center justify-between">
        <span className="text-ink-500">Best execution</span>
        <span className="text-primary-700 font-semibold">
          {venueLabel(route.venue)}
        </span>
      </Row>
      <Row className="text-ink-600 justify-between">
        <span>
          {side === 'BUY'
            ? `Est. ${outcome} shares`
            : `Est. proceeds`}
        </span>
        <span>{side === 'BUY' ? shares.toFixed(2) : `$${usdc.toFixed(2)}`}</span>
      </Row>
      <Row className="text-ink-600 justify-between">
        <span>Effective price</span>
        <span>{avgCents}¢</span>
      </Row>
      {side === 'BUY' && (
        <Row className="text-ink-500 justify-between">
          <span>Payout if {outcome} wins</span>
          <span>${shares.toFixed(2)}</span>
        </Row>
      )}
      {!q.complete && (
        <span className="text-ink-400">
          Book depth is thin — quote reflects only what can fill now.
        </span>
      )}
      {other && (
        <span className="text-ink-400">
          {venueLabel(other.venue)} alt: {(other.avgPrice * 100).toFixed(1)}¢
        </span>
      )}
    </Col>
  )
}

/** Button label for the trade action, reflecting the routed venue on MARKET. */
function marketButtonLabel(args: {
  connected: boolean
  mode: OrderMode
  side: TradeSide
  outcome: Outcome
  route: BestExecution | null
  quoting: boolean
  hasAmount: boolean
}): string {
  const { connected, mode, side, outcome, route, quoting, hasAmount } = args
  if (!connected) return 'Connect wallet'
  const verb = side === 'BUY' ? 'Buy' : 'Sell'
  if (mode === 'LIMIT') return `${verb} ${outcome} (limit)`
  if (!hasAmount) return `${verb} ${outcome}`
  if (quoting && !route) return 'Finding best price…'
  if (!route || route.venue === 'none') return 'No liquidity'
  return `${verb} ${outcome} · ${venueLabel(route.venue)}`
}

function AdvancedPanel(props: {
  advanced: AdvancedAction
  setAdvanced: (a: AdvancedAction) => void
  amount: string
  setAmount: (v: string) => void
  busy: boolean
  onSubmit: () => void
  connected: boolean
  pending: PendingAction | null
}) {
  const {
    advanced,
    setAdvanced,
    amount,
    setAmount,
    busy,
    onSubmit,
    connected,
    pending,
  } = props
  return (
    <Col className="border-ink-200 gap-3 rounded-md border p-3">
      <Row className="bg-canvas-50 rounded-md p-0.5">
        <SegTab active={advanced === 'split'} onClick={() => setAdvanced('split')}>
          Mint set
        </SegTab>
        <SegTab active={advanced === 'merge'} onClick={() => setAdvanced('merge')}>
          Redeem set
        </SegTab>
      </Row>
      <Col className="gap-1">
        <label className="text-ink-500 text-xs">
          {advanced === 'split'
            ? 'Spend (USDC) — get equal YES + NO shares'
            : 'Shares to merge back to USDC'}
        </label>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
      </Col>
      {pending && <PendingBanner pending={pending} />}
      <Button
        color="gray"
        size="md"
        loading={busy}
        disabled={!!pending}
        onClick={onSubmit}
      >
        {pending
          ? pending.label
          : !connected
          ? 'Connect wallet'
          : advanced === 'split'
          ? 'Mint YES + NO'
          : 'Merge to USDC'}
      </Button>
    </Col>
  )
}

/**
 * Compact optimistic-state banner shown while a real on-chain tx confirms. It
 * surfaces the intended position/USDC delta so the box gives immediate feedback
 * instead of appearing frozen. Reconciled away on success/error by the caller.
 */
function PendingBanner(props: { pending: PendingAction }) {
  const { pending } = props
  return (
    <Row className="border-primary-200 bg-primary-50 text-primary-700 items-center justify-between rounded-md border px-3 py-2 text-xs">
      <span className="font-semibold">Confirming on-chain…</span>
      <span className="text-primary-600">{pending.detail}</span>
    </Row>
  )
}

function OutcomeChip(props: {
  color: 'teal' | 'scarlet'
  label: string
  price: number
  active?: boolean
  onClick?: () => void
}) {
  const { color, label, price, active, onClick } = props
  const interactive = !!onClick
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onClick}
      className={clsx(
        'flex-1 rounded-md border py-2 text-center transition-colors',
        color === 'teal'
          ? 'border-teal-400 text-teal-800'
          : 'border-scarlet-400 text-scarlet-800',
        interactive && !active && 'opacity-60 hover:opacity-100',
        active &&
          (color === 'teal' ? 'bg-teal-50 ring-1 ring-teal-400' : 'bg-scarlet-50 ring-1 ring-scarlet-400')
      )}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-xs">{price}%</div>
    </button>
  )
}

function SegTab(props: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  const { active, onClick, children } = props
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex-1 rounded py-1.5 text-sm font-semibold transition-colors',
        active ? 'bg-canvas-0 text-ink-900 shadow-sm' : 'text-ink-500'
      )}
    >
      {children}
    </button>
  )
}
