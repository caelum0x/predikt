import { useState } from 'react'
import { LuCopy } from 'react-icons/lu'
import { Bet } from 'common/bet'
import { BinaryContract, MarketContract } from 'common/contract'
import { formatMoney } from 'common/util/format'
import { firebaseLogin } from 'web/lib/firebase/users'
import { useUser } from 'web/hooks/use-user'
import { track } from 'web/lib/service/analytics'
import { Tooltip } from 'web/components/widgets/tooltip'
import { BetDialog } from './bet-dialog'

// "Copy this trade" mirrors a real trade another trader placed. It opens the
// normal bet panel pre-filled with the SAME market + outcome and a suggested
// stake derived from the original trade. It never auto-executes — the copier
// still confirms in the panel. This is a one-tap mirror, not a bot.

// Only single-outcome binary markets can be safely one-tap mirrored, because
// the bet panel used here (BetDialog) targets BinaryContract.
function isCopyableBinaryContract(
  contract: MarketContract
): contract is BinaryContract {
  return contract.outcomeType === 'BINARY'
}

export function CopyTradeButton(props: {
  bet: Bet
  contract: MarketContract
  className?: string
}) {
  const { bet, contract, className } = props
  const user = useUser()
  const [open, setOpen] = useState(false)

  // Don't offer to copy your own trade, sells, or non-binary/limit trades that
  // this simple mirror can't faithfully reproduce.
  const isSell = bet.amount < 0
  const isLimitOrder = bet.limitProb !== undefined
  if (
    isSell ||
    isLimitOrder ||
    !isCopyableBinaryContract(contract) ||
    (user && user.id === bet.userId)
  ) {
    return null
  }

  const outcome = bet.outcome === 'YES' || bet.outcome === 'NO' ? bet.outcome : undefined
  if (!outcome) return null

  // Suggested stake = the amount the followed trader put in, capped to what the
  // copier can actually afford. Real numbers only — no invented sizing.
  const originalAmount = Math.abs(bet.amount)
  const affordable =
    user && user.balance > 0
      ? Math.max(1, Math.min(originalAmount, Math.floor(user.balance)))
      : originalAmount
  const suggestedAmount = Math.round(affordable)

  const handleClick = () => {
    if (!user) {
      firebaseLogin()
      return
    }
    track('copy trade', {
      contractId: contract.id,
      fromUserId: bet.userId,
      outcome,
      suggestedAmount,
    })
    setOpen(true)
  }

  return (
    <>
      <Tooltip
        text={`Copy this trade — ${formatMoney(
          suggestedAmount,
          contract.token
        )} ${outcome}`}
        placement="top"
      >
        <button
          className={
            className ??
            'text-ink-400 hover:text-primary-600 hover:bg-primary-100 rounded-md p-1.5 transition-colors'
          }
          onClick={handleClick}
          aria-label="Copy this trade"
        >
          <LuCopy className="h-4 w-4" />
        </button>
      </Tooltip>

      {open && isCopyableBinaryContract(contract) && (
        <BetDialog
          contract={contract}
          open={open}
          setOpen={setOpen}
          trackingLocation="copy trade"
          initialOutcome={outcome}
          initialAmount={suggestedAmount}
        />
      )}
    </>
  )
}
