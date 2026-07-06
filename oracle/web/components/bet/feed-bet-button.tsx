import clsx from 'clsx'
import { useState } from 'react'
import { Button } from '../buttons/button'
import { Col } from '../layout/col'
import { Row } from '../layout/row'
import { Modal, MODAL_CLASS } from '../layout/modal'
import { BuyPanel } from './bet-panel'
import { track } from 'web/lib/service/analytics'
import { BinaryContract, StonkContract } from 'common/contract'
import { getDisplayProbability } from 'common/calculate'
import { User, firebaseLogin } from 'web/lib/firebase/users'
import { TRADE_TERM } from 'common/envs/constants'
import { capitalize } from 'lodash'
import {
  getCustomYesButtonText,
  getCustomNoButtonText,
} from 'common/shop/items'

export function BetButton(props: {
  contract: BinaryContract | StonkContract
  user: User | null | undefined
  feedReason?: string
  className?: string
  labels?: { yes: string; no: string }
  questionTitle?: string
  /** Polymarket-style: full-width green YES / red NO buttons showing prices in cents */
  variant?: 'prominent'
}) {
  const {
    contract,
    labels,
    user,
    className,
    feedReason,
    questionTitle,
    variant,
  } = props
  const { closeTime } = contract
  const isClosed = closeTime && closeTime < Date.now()
  const customYesText = getCustomYesButtonText(user?.entitlements)
  const customNoText = getCustomNoButtonText(user?.entitlements)
  const [dialogueThatIsOpen, setDialogueThatIsOpen] = useState<
    string | undefined
  >(undefined)
  if (isClosed) return null
  const open = dialogueThatIsOpen === 'YES' || dialogueThatIsOpen === 'NO'

  const handleBetButtonClick = (outcome: 'YES' | 'NO') => {
    if (!user) {
      firebaseLogin()
      return
    }
    track('bet intent', {
      location: 'feed card',
      outcome,
      token: contract.token,
    })
    setDialogueThatIsOpen(outcome)
  }

  const yesLabel = labels?.yes ?? customYesText ?? capitalize(TRADE_TERM) + ' Yes'
  const noLabel = labels?.no ?? customNoText ?? capitalize(TRADE_TERM) + ' No'

  if (variant === 'prominent') {
    const prob = getDisplayProbability(contract)
    const yesCents = Math.round(prob * 100)
    const noCents = 100 - yesCents
    return (
      <div className={clsx('w-full', className)}>
        <Row className="w-full gap-2">
          <button
            type="button"
            aria-label={`${yesLabel} on ${questionTitle ?? contract.question}`}
            aria-haspopup="dialog"
            onClick={() => handleBetButtonClick('YES')}
            className="bg-teal-500/15 text-teal-600 hover:bg-teal-500/25 dark:text-teal-400 flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 font-semibold transition-colors"
          >
            <span>{labels?.yes ?? 'Yes'}</span>
            <span className="tabular-nums">{yesCents}¢</span>
          </button>
          <button
            type="button"
            aria-label={`${noLabel} on ${questionTitle ?? contract.question}`}
            aria-haspopup="dialog"
            onClick={() => handleBetButtonClick('NO')}
            className="bg-scarlet-500/15 text-scarlet-600 hover:bg-scarlet-500/25 dark:text-scarlet-400 flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 font-semibold transition-colors"
          >
            <span>{labels?.no ?? 'No'}</span>
            <span className="tabular-nums">{noCents}¢</span>
          </button>
        </Row>

        {open && (
          <BetModal
            contract={contract}
            questionTitle={questionTitle}
            feedReason={feedReason}
            dialogueThatIsOpen={dialogueThatIsOpen}
            setDialogueThatIsOpen={setDialogueThatIsOpen}
            open={open}
          />
        )}
      </div>
    )
  }

  return (
    <div className={className}>
      <Button
        color="green-outline"
        size="xs"
        aria-label={`${yesLabel} on ${questionTitle ?? contract.question}`}
        aria-haspopup="dialog"
        onClick={() => handleBetButtonClick('YES')}
        className="mr-2"
      >
        {yesLabel}
      </Button>

      <Button
        color="red-outline"
        size="xs"
        aria-label={`${noLabel} on ${questionTitle ?? contract.question}`}
        aria-haspopup="dialog"
        onClick={() => handleBetButtonClick('NO')}
      >
        {noLabel}
      </Button>

      {open && (
        <BetModal
          contract={contract}
          questionTitle={questionTitle}
          feedReason={feedReason}
          dialogueThatIsOpen={dialogueThatIsOpen}
          setDialogueThatIsOpen={setDialogueThatIsOpen}
          open={open}
        />
      )}
    </div>
  )
}

// Shared bet modal used by both the default and prominent button variants.
function BetModal(props: {
  contract: BinaryContract | StonkContract
  questionTitle?: string
  feedReason?: string
  dialogueThatIsOpen: string | undefined
  setDialogueThatIsOpen: (v: string | undefined) => void
  open: boolean
}) {
  const {
    contract,
    questionTitle,
    feedReason,
    dialogueThatIsOpen,
    setDialogueThatIsOpen,
    open,
  } = props
  return (
    <Modal
      open={open}
      ariaLabel={`Bet on ${questionTitle ?? contract.question}`}
      setOpen={(o) => {
        setDialogueThatIsOpen(o ? dialogueThatIsOpen : undefined)
      }}
      className={clsx(
        MODAL_CLASS,
        'pointer-events-auto max-h-[32rem] overflow-auto'
      )}
    >
      <Col>
        <h2 className="mb-4 mt-0 text-xl">
          {questionTitle ?? contract.question}
        </h2>
        <BuyPanel
          contract={contract}
          initialOutcome={dialogueThatIsOpen === 'YES' ? 'YES' : 'NO'}
          onBuySuccess={() =>
            setTimeout(() => setDialogueThatIsOpen(undefined), 500)
          }
          location={'feed card'}
          inModal={true}
          feedReason={feedReason}
        />
        <Row className="mt-3 justify-end">
          <a
            href={`/${contract.creatorUsername}/${contract.slug}`}
            className="text-ink-400 hover:text-ink-600 text-[13px] transition-colors"
            onClick={() => setDialogueThatIsOpen(undefined)}
          >
            View market →
          </a>
        </Row>
      </Col>
    </Modal>
  )
}
