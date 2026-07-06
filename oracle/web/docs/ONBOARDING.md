# Onboarding funnel (Phase 1)

Goal: make the first trade frictionless and keep crypto invisible. The default
experience is the off-chain play-money app — every on-chain piece below is gated
behind `isOnchainEnabled()` (from `lib/onchain/addresses.ts`) and is a strict
no-op when the on-chain contract env vars are unset.

## Pieces

### 1. Embedded wallet auto-provision — `hooks/use-embedded-wallet.ts`
Runs after a user authenticates. When on-chain is enabled and the user has no
device wallet yet, it silently `createWallet()`s one (generate + encrypt +
persist locally) so on-chain markets work with **no separate "connect wallet"
step**. The seed phrase is never surfaced (`createWallet` returns only an
address). Idempotent: an existing wallet is reused, never re-created. Exposes
`{ address, usdcBalance, usdcFormatted, ready, provisioning, refresh }`.

- **Active** as soon as the on-chain env vars are set (see §Env).
- When off-chain, returns an inert state and does nothing.
- Mounted app-wide via `components/onboarding/onboarding-root.tsx`, rendered
  inside `AuthProvider` in `pages/_app.tsx`.

### 2. Welcome intro — `components/onboarding/welcome-onboarding.tsx`
Icon-first, 3-step, plain-copy intro for brand-new signed-in users:
"Browse questions" → "Pick a side" → "Your balance grows". Ends by dropping the
user into the markets feed (`/browse`). Shows **once**, tracked in local state
(`predikt-welcome-onboarding-seen-v1`). No walls: Skip/close works instantly, and
it never mentions wallets, USDC, gas, or chains.

- **Fully working** now (pure client, no backend needed).

### 3. Sign in with Apple — `pages/login.tsx` + `lib/firebase/users.ts`
The login page renders "Continue with Apple" next to "Continue with Google", and
`loginWithApple()` uses Firebase's Apple `OAuthProvider`. **Client code is
complete.** App Store requires this alongside Google.

To **activate** the provider (one-time console config, no code change):
1. Firebase console → Authentication → Sign-in method → enable **Apple**.
2. Apple Developer portal: create a **Services ID**, enable "Sign in with Apple",
   register the Firebase auth handler redirect
   `https://<project>.firebaseapp.com/__/auth/handler`, create a **Sign in with
   Apple key**, and paste Services ID + Team ID + Key ID + private key into the
   Firebase Apple provider config.
3. iOS app: add the **Sign in with Apple** capability in Xcode and list
   `oracle.markets` as an associated domain.

Until steps 1–2 are done, the button renders but the call fails with
`auth/operation-not-allowed`.

### 4. Cash balance in nav — `components/nav/profile-summary.tsx`
When on-chain is enabled and the embedded wallet is ready, the sidebar profile
shows the real USDC balance labelled plainly as **"cash"** (tokens, not hex),
next to the play-money balance. When off-chain, the display is unchanged.

- **Active** when on-chain env is set and a wallet exists.

### 5. Gasless integration seam — `lib/onchain/gasless.ts`
Typed, documented ERC-4337 seam: `isGaslessEnabled()`, `getPaymasterUrl()`, and
`sponsorUserOp()` reading `NEXT_PUBLIC_PAYMASTER_URL`. **No paid service is
hardcoded and no secret is embedded.** When the env is unset, gasless is off and
on-chain txs fall back to the user paying their own gas (current behavior).

To plug in a **free-tier** paymaster:
1. Point `NEXT_PUBLIC_PAYMASTER_URL` at any EIP-4337 bundler/paymaster RPC that
   offers a free sponsored-gas tier (a paymaster RPC URL is public, like an RPC
   URL). If your provider requires a secret key, proxy it through your own
   backend route and point the env at that route.
2. `sponsorUserOp()` issues the de-facto-standard `pm_sponsorUserOperation`
   JSON-RPC and returns `paymasterAndData` (+ optional re-quoted gas) to merge
   into a UserOperation.
3. **Next implementation step (not yet wired):** build the UserOperation from a
   smart account derived from the same embedded key (SimpleAccount / Kernel /
   Safe4337 module) and submit via `eth_sendUserOperation`. The seam is
   deliberately isolated so this can land without touching call sites.

## Env

| Var | Purpose | Unset behavior |
| --- | --- | --- |
| `NEXT_PUBLIC_ONCHAIN_UMA_ADAPTER` / `_EXCHANGE` / `_CONDITIONAL_TOKENS` / `_UMA_OPTIMISTIC_ORACLE` | Enable the on-chain path (`isOnchainEnabled()`) | On-chain fully hidden; embedded wallet + cash balance are no-ops |
| `NEXT_PUBLIC_PAYMASTER_URL` | Free-tier ERC-4337 paymaster for gasless first-trades | Gasless off; user pays own gas |
| Firebase Apple provider (console, not env) | Activate Sign in with Apple | Button shows; sign-in errors until enabled |

All contract addresses and the paymaster URL are **public** (`NEXT_PUBLIC_*`) —
no secrets are stored client-side.

## Active vs. needs-config

- **Fully working now:** welcome intro (§2); Apple button rendered in the login
  UI with complete client wiring (§3); embedded-wallet auto-provision and the
  cash-balance display **once on-chain env is set** (§1, §4).
- **Needs one-time console config:** Firebase Apple provider + Apple Developer
  setup to make Apple sign-in actually authenticate (§3).
- **Needs env + a follow-up implementation step:** gasless sponsorship — set
  `NEXT_PUBLIC_PAYMASTER_URL` and complete the 4337 smart-account/UserOperation
  wiring at the seam in `lib/onchain/gasless.ts` (§5).
