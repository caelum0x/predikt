'use client'
import {
  ChartBarIcon,
  ScaleIcon,
  SparklesIcon,
} from '@heroicons/react/solid'
import clsx from 'clsx'
import { useRouter } from 'next/router'
import { useEffect, useState, type ComponentType } from 'react'
import { Button } from 'web/components/buttons/button'
import { Col } from 'web/components/layout/col'
import { Modal } from 'web/components/layout/modal'
import { Row } from 'web/components/layout/row'
import { usePersistentLocalState } from 'web/hooks/use-persistent-local-state'
import { useUser } from 'web/hooks/use-user'

// Version-suffixed so we can re-run the intro later without colliding with the
// original welcome flow's own persistence.
const SEEN_KEY = 'predikt-welcome-onboarding-seen-v1'

interface Step {
  Icon: ComponentType<{ className?: string }>
  title: string
  body: string
  /** Tailwind tint using existing theme tokens; icon-first, no product names. */
  tint: string
}

// Icon-first, plain copy. Three beats: browse -> pick a side -> your balance.
const STEPS: Step[] = [
  {
    Icon: ChartBarIcon,
    title: 'Browse questions',
    body: 'Scroll a live feed of questions about the future — politics, tech, sports and more.',
    tint: 'text-primary-600',
  },
  {
    Icon: ScaleIcon,
    title: 'Pick a side',
    body: 'Think it happens? Tap yes. Think it won’t? Tap no. The price is the crowd’s best guess.',
    tint: 'text-teal-600',
  },
  {
    Icon: SparklesIcon,
    title: 'Your balance grows',
    body: 'You start with a balance to play with. Get it right and it grows. No money needed.',
    tint: 'text-primary-600',
  },
]

/**
 * Lightweight, icon-first intro for brand-new users. Three plain-copy steps that
 * end by dropping the user into the markets feed. Shows once (tracked in local
 * state) and never walls the app — the user can close or skip instantly.
 *
 * Crypto stays invisible here: nothing about wallets, USDC, gas or chains is
 * mentioned. The default off-chain play-money experience is what we describe.
 */
export function WelcomeOnboarding() {
  const user = useUser()
  const router = useRouter()

  const [seen, setSeen, seenReady] = usePersistentLocalState<boolean>(
    false,
    SEEN_KEY
  )
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  // Only surface for a signed-in, brand-new user who hasn't seen it yet.
  useEffect(() => {
    if (!seenReady) return
    if (user && !seen) setOpen(true)
  }, [seenReady, user, seen])

  const finish = (goToFeed: boolean) => {
    setSeen(true)
    setOpen(false)
    // Drop them into the markets feed. Only navigate if they aren't already on
    // a browsing surface, so we never yank someone off a page they opened.
    if (goToFeed) {
      const path = router.pathname
      if (path !== '/home' && path !== '/browse' && path !== '/') {
        router.push('/browse').catch(() => {})
      }
    }
  }

  if (!user) return null

  const isLast = step === STEPS.length - 1
  const { Icon, title, body, tint } = STEPS[step]

  return (
    <Modal open={open} setOpen={(o) => (o ? setOpen(true) : finish(false))}>
      <Col className="bg-canvas-0 items-center gap-5 rounded-md px-6 py-8 text-center">
        <div
          className={clsx(
            'bg-canvas-50 flex h-20 w-20 items-center justify-center rounded-full'
          )}
        >
          <Icon className={clsx('h-10 w-10', tint)} aria-hidden />
        </div>

        <Col className="gap-2">
          <span className="text-ink-900 text-xl font-semibold">{title}</span>
          <span className="text-ink-600 max-w-xs text-sm">{body}</span>
        </Col>

        {/* Step dots — icon-first progress, no words needed. */}
        <Row className="gap-1.5" aria-hidden>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={clsx(
                'h-2 w-2 rounded-full transition-colors',
                i === step ? 'bg-primary-600' : 'bg-ink-300'
              )}
            />
          ))}
        </Row>

        <Row className="w-full items-center justify-between gap-3">
          <Button
            color="gray-white"
            size="sm"
            onClick={() => finish(true)}
            aria-label="Skip intro"
          >
            Skip
          </Button>
          <Button
            color="blue"
            size="md"
            onClick={() => (isLast ? finish(true) : setStep(step + 1))}
          >
            {isLast ? 'Start browsing' : 'Next'}
          </Button>
        </Row>
      </Col>
    </Modal>
  )
}
