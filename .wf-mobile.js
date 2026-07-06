export const meta = {
  name: 'predikt-mobile-push',
  description: 'Rebrand the existing native WebView app (oracle/native) to Predikt + scrub foreign identifiers, and wire push notifications end-to-end (native register -> token -> backend -> send) + web push. Static-verify + review.',
  phases: [
    { title: 'Rebrand' },
    { title: 'Push' },
    { title: 'Review' },
  ],
}

const O = '/Users/arhansubasi/expo games and apps/prediction/oracle'
const NAT = '/Users/arhansubasi/expo games and apps/prediction/oracle/native'
const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'

const ENV = `HEADLESS: no iOS simulator / Android emulator / device — the native app CANNOT be built or run here. Output is STATIC-checked (config validity + tsc + careful edits), NOT runtime-verified — be honest about that. Don't run \`eas build\`/\`expo run\`. You MAY run \`npx tsc --noEmit\` where a tsconfig exists.`
const RULE = `Brand is PREDIKT. EDIT IN PLACE the existing app (do NOT scaffold a new native app; the WebView-shell approach reuses the web app we built). REAL ONLY, no mock/stub. No secrets committed. Icon-first, plain copy, no tech/product-name leaks. Keep the WebView shell logic intact.`

// ---------- Phase 1: rebrand the native app + scrub foreign IDs ----------
phase('Rebrand')
log('Rebrand oracle/native -> Predikt + scrub Manifold/foreign identifiers.')
const rebrand = await agent(`Rebrand the existing native WebView app at ${NAT} to Predikt and scrub identifiers that are NOT ours.
${RULE}
${ENV}
1) app.config.js: name 'Oracle' -> 'Predikt'; slug -> 'predikt'; iOS bundleIdentifier + Android package 'com.oracle.app' -> 'com.predikt.app'; scheme -> 'predikt' (it currently mis-uses 'com.oracle.app' as scheme — fix to a real scheme 'predikt'). Version/build sane.
2) SCRUB FOREIGN IDENTIFIERS (these belong to Manifold, not us — like the Evan Bacon IDs we scrubbed before):
   - EAS/Expo updates url + projectId '0ce454fc-3885-4eab-88b6-787b1691973b' -> a REPLACE_WITH_EAS_PROJECT_ID placeholder (+ note "run eas init" in a SHIP note).
   - Sentry organization 'manifold-markets' -> a REPLACE_WITH_SENTRY_ORG placeholder (or remove Sentry config if trivial); no Manifold DSN.
   - Deep-link / associated-domains 'oracle.markets' + 'applinks:oracle.markets' + 'webcredentials:oracle.markets' -> the app's real domain via a single BASE_URI/DOMAIN constant (default to a REPLACE_WITH_DOMAIN or the app's configured domain; keep them consistent).
3) App.tsx BASE_URI: 'https://oracle.markets/' / dev 'https://dev.oracle.markets/' -> read from a single config/env constant (EXPO_PUBLIC_WEB_URL) so the shell points at the Predikt web deployment; default documented. custom-webview + auth-page hardcoded docs.oracle.markets/... URLs -> the same domain constant.
4) Icons/splash/adaptiveIcon: point at Predikt assets (reuse existing asset paths; if the images are Manifold-branded, note they need replacing — don't fabricate images).
5) Grep ${NAT} for 'manifold', 'Manifold', 'mantic', 'oracle.markets', 'com.oracle', '0ce454fc' and fix every user-visible/config occurrence (folder names + native project artifact dirs like ios/oracle may stay). eas.json: channels/projectId placeholder.
Output: every identifier changed, the single domain/URL constant, foreign IDs scrubbed, and a note on which assets still need real Predikt art.`, { label: 'rebrand', phase: 'Rebrand', agentType: 'general-purpose' })

// ---------- Phase 2: push notifications end-to-end ----------
phase('Push')
log('Wire push notifications end-to-end (native register -> token -> backend -> send) + web push.')
const push = await agent(`Wire PUSH NOTIFICATIONS end-to-end for Predikt across the existing native app (${NAT}), the web app (${WEB}), and the shared notification system (${O}/common, ${O}/backend). The infra already exists — verify it, complete gaps, and rebrand.
${RULE}
${ENV}
Trace and make coherent the full flow:
1) NATIVE registration: in ${NAT}, ensure the app requests notification permission + gets the Expo push token (expo-notifications getExpoPushTokenAsync with the EAS projectId) and delivers it to the web layer via the existing native bridge (${WEB}/lib/native/post-message + native-messages) — OR registers it directly. If the registration code is missing/partial, add it (real expo-notifications). Handle foreground/response handlers (tapping a push deep-links into the right market via the scheme/domain).
2) WEB side: ${WEB}/lib/native/* + ${WEB}/lib/supabase/notifications.ts + components/push-notifications-modal + notification-settings — confirm the web receives the native push token and registers it with the backend (the push_notification_tickets table), and that notification PREFERENCES (common/src/user-notification-preferences) are wired. Also confirm/complete WEB PUSH (browser) if a service worker/subscription path exists; if not, note it.
3) BACKEND send: ${O}/backend + common/src/push-ticket.ts + notification.ts + backend/supabase/{push_notification_tickets,user_notifications,contract_movement_notifications}.sql — confirm the path that SENDS an Expo push (market resolved, your bet won, new comment, reply, someone you follow traded, price/market movement) reads valid tickets and posts to Expo's push API. Rebrand any Manifold/"mana" wording in notification COPY to Predikt/plain terms. Don't change the DB schema unless needed; wire, don't rebuild.
4) Make sure notification content is Predikt-branded, plain, icon-first, no tech-name leaks; and that a user can enable/disable categories.
Run \`npx tsc --noEmit\` where tsconfigs exist (web, and native if it has one). Output: the end-to-end flow (register -> store ticket -> send), what existed vs what you added, which notification types fire, and the tsc result. Be honest about what can't be verified without a device.`, { label: 'push', phase: 'Push', agentType: 'general-purpose' })

// ---------- Phase 3: review ----------
phase('Review')
log('Review mobile rebrand + push.')
const review = await agent(`Review the Predikt mobile + push work. Confirm: the native app (${NAT}) is rebranded to Predikt (name/bundle/package/scheme = com.predikt.app/predikt) with NO foreign identifiers left (grep for 'manifold','mantic','com.oracle','0ce454fc','manifold-markets' in config/user-visible spots — flag any); the WebView shell points at a single configurable Predikt web URL; the push flow is coherent end-to-end (native token -> web -> backend push_notification_tickets -> Expo send) with real expo-notifications (no mock); notification copy is Predikt-branded + plain, no tech-name leaks; no secrets/foreign DSNs; tsc clean where checkable. Note honestly what needs a real device/EAS project/assets to fully activate. Report CRITICAL/HIGH/MED/LOW with file:line + a 0-10 score + a "mobile launch readiness" note.`, { label: 'review', phase: 'Review', agentType: 'code-reviewer' })

return { rebrand, push, review }
