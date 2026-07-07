export const meta = {
  name: 'cipher-vertex-appstore-ready',
  description: 'Make Cipher + Vertex App Store submission-ready and monetization-real: real RevenueCat IAP (no demo no-op), ATT+UMP ads consent, submission config (bundle/permissions/privacy manifest), metadata + review notes. Static-verify.',
  phases: [
    { title: 'Ready' },
    { title: 'Verify' },
  ],
}

const V = '/Users/arhansubasi/expo games and apps/pillar-valley'
const C = '/Users/arhansubasi/expo games and apps/TheLock'
const ENV = `Headless: NO device/simulator, disk may be tight — do NOT run heavy fresh installs; run \`npx tsc --noEmit\` only if node_modules already exists, else rely on careful typed edits. Runtime (real purchases/ads/receipts) can only be verified on a device with configured store products — be honest about that; your job is to make the CODE real + the config + the docs correct. REAL ONLY (no stub/no-op in the production path), no secrets committed (store/ad keys via env or app config, Google TEST ad ids as safe fallback), plain copy, keep the game working.`

const SUBMIT = `SUBMISSION CONFIG (do all): app.json/app.config — expo.ios.bundleIdentifier + expo.android.package (com.<brand>.app), version + buildNumber/versionCode, all permission usage-description strings as real sentences (incl. NSUserTrackingUsageDescription for ATT + any camera/photos/notifications used), ITSAppUsesNonExemptEncryption=false, and the plugins for the native modules used. eas.json: valid development/preview/production profiles. iOS PRIVACY MANIFEST: add ios/.../PrivacyInfo.xcprivacy (or the expo plugin config) declaring the data types collected (identifiers for ads, purchase history, usage/analytics) + required-reason API usages — matching what the app actually does. Write an APP-STORE metadata file (name, subtitle, promotional text, description, keywords, category, age rating notes, support + privacy URLs -> the websites/ pages) + REVIEW NOTES (how to test IAP with a sandbox account, that ads use test ids until real ones are set, any demo steps). Scrub any user-visible placeholder/"coming soon"/TODO copy.`

phase('Ready')
log('Make Cipher + Vertex submission-ready + monetization-real (parallel).')

const vertex = () => agent(`Make **Vertex** (${V}) App Store submission-ready + monetization real.
1) IAP — the real RevenueCat path must be used in production; the no-op demo adapter must NOT be selected on a store build. In src/lib/iap/ (index.ts/types.ts/demo.ts/nativeIapAdapter.ts/revenueCatAdapter.ts) + Purchases.ts + StoreProducts.ts + useConfigurePurchases.ts: make the adapter selection pick RevenueCat (react-native-purchases) when configured (EXPO_PUBLIC_REVENUECAT_* keys present / native available), fall back to demo ONLY in Expo Go / dev. Ensure purchase, RESTORE, and entitlement-gating are real (offerings -> purchasePackage -> customerInfo.entitlements), and StoreProducts defines the real product identifiers (from app config, documented for App Store Connect + RevenueCat). Cosmetics/season-pass/subscription entitlements must actually unlock from a real purchase, not the demo.
2) ADS — ATT + UMP consent already exist (src/lib/ads/consent.ts, useAdConsent, ConsentPrompt); verify the flow: request ATT (expo-tracking-transparency) + Google UMP consent BEFORE ads init, and AdMob unit/app ids come from config with Google TEST ids as fallback. Confirm rewarded/interstitial are real and gated on consent.
3) ${SUBMIT}
${ENV}
Output: IAP made real (adapter selection + products), ads/consent confirmed, submission config + privacy manifest + metadata + review notes written, tsc result.`, { label: 'vertex-ready', phase: 'Ready', agentType: 'general-purpose' })

const cipher = () => agent(`Make **Cipher** (${C}) App Store submission-ready + monetization real.
1) IAP — verify/complete the RevenueCat (react-native-purchases) flow: real offerings -> purchase -> restore -> entitlement gating (subs + consumables/coins), no stub in the production path. Ensure the subscription/coin-store screens (src/screens/subscription/*, PurchaseSummary) call real purchase/restore and that entitlements actually unlock features/coins. Define the real product identifiers in config, documented for App Store Connect + RevenueCat.
2) ADS — Cipher appears to be MISSING the ATT/UMP consent flow (a hard Apple blocker for ad SDKs). ADD it: an app-tracking-transparency prompt (expo-tracking-transparency) + Google UMP consent (react-native-google-mobile-ads AdsConsent / requestConsentInfoUpdate) that runs BEFORE AdMob initializes and gates personalized ads; AdMob app/unit ids from config with Google TEST ids as fallback. Add an ads/privacy settings toggle if trivial. Match Vertex's pattern (${V}/src/lib/ads) for consistency.
3) ${SUBMIT}
${ENV}
Output: IAP confirmed/made real, ATT+UMP consent ADDED (files), submission config + privacy manifest + metadata + review notes, tsc result.`, { label: 'cipher-ready', phase: 'Ready', agentType: 'general-purpose' })

const ready = (await parallel([vertex, cipher])).filter(Boolean)

phase('Verify')
log('App Store readiness review of both games.')
const review = await agent(`Review **Cipher** (${C}) and **Vertex** (${V}) for App Store SUBMISSION readiness. For EACH, check + report PASS/PARTIAL/FAIL with file:line:
- IAP: real RevenueCat purchase/restore/entitlement in the production path (NO demo/stub no-op selected on a store build); product ids defined + documented.
- ADS: ATT (NSUserTrackingUsageDescription + prompt) + UMP consent run BEFORE ads init; test-id fallback; no ads before consent.
- Config: bundle id/package, version+build, ALL permission usage strings (real sentences), ITSAppUsesNonExemptEncryption, plugins.
- Privacy: PrivacyInfo.xcprivacy declares the real collected data types + required-reason APIs.
- Metadata + review notes present + accurate; support/privacy URLs point at real websites/ pages.
- No user-visible placeholder/"coming soon"; tsc clean.
Give each app a 0-10 "App Store submission readiness" score, the exact blocking items left, and a short "what needs a device + configured store products to finish" note.`, { label: 'review', phase: 'Verify', agentType: 'code-reviewer' })

return { ready: ready.length, review }
