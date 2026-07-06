'use client'
import { useEmbeddedWallet } from 'web/hooks/use-embedded-wallet'
import { WelcomeOnboarding } from 'web/components/onboarding/welcome-onboarding'

/**
 * App-wide onboarding mount, rendered inside the auth context.
 *
 * Two responsibilities, both gated so the off-chain default is untouched:
 *  1. Silently provision the embedded on-chain wallet on first authenticated
 *     load (a no-op unless `isOnchainEnabled()` — see use-embedded-wallet).
 *  2. Show the icon-first welcome intro to brand-new users (once).
 *
 * Kept as a tiny mount so `_app.tsx` stays declarative.
 */
export function OnboardingRoot() {
  // Runs the provisioning side effect. We don't need its return value here —
  // the balance is read where it's displayed (nav/profile).
  useEmbeddedWallet()

  return <WelcomeOnboarding />
}
