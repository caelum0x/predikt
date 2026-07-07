export const meta = {
  name: 'cipher-vertex-e2e-audit',
  description: 'Production-grade end-to-end audit of Cipher + Vertex: enumerate ALL screens/APIs/features, find every incomplete/stubbed/dead-end, FIX to complete end-to-end, then verify + per-app completeness report.',
  phases: [
    { title: 'Audit' },
    { title: 'Fix' },
    { title: 'Verify' },
  ],
}

const APPS = {
  Vertex: '/Users/arhansubasi/expo games and apps/pillar-valley',
  Cipher: '/Users/arhansubasi/expo games and apps/TheLock',
}
const SECT = '/Users/arhansubasi/expo games and apps/.audit'
const ENV = `Headless: NO device/simulator, disk may be tight — no heavy fresh installs; run \`npx tsc --noEmit\` only if node_modules exists, else careful typed edits. Runtime (live gameplay, real IAP/ads, online multiplayer, backend) can only be confirmed on a device/live service — be honest about that; audit + complete the CODE end-to-end. REAL ONLY — no stub/mock/placeholder/dead-end in production paths; no secrets.`

const AUDIT_DIMS = (name, path) => [
  {
    label: `${name}:audit-screens`,
    file: `${name.toLowerCase()}-screens.md`,
    spec: `Audit EVERY SCREEN + NAVIGATION + user FLOW of "${name}" (${path}). Enumerate all screens/routes (app/ or src/app or screens/). For EACH: does it render real content, is it REACHABLE (a nav path leads to it), are all buttons/actions wired (no dead onPress), are loading/error/empty states handled, does back/nav work, any placeholder/"coming soon"/TODO/lorem copy? Then trace the core FLOWS end-to-end (game loop start->play->game-over->reward; onboarding; settings; each game mode; daily/streak; leaderboard view/submit; profile/stats; store/paywall; any online/duel/tournament). Flag every INCOMPLETE item (screen, button, flow) with file:line, what's missing, and severity (BLOCKER/HIGH/MED/LOW). Write findings to ${SECT}/${name.toLowerCase()}-screens.md.`,
  },
  {
    label: `${name}:audit-services`,
    file: `${name.toLowerCase()}-services.md`,
    spec: `Audit EVERY SERVICE / API / DATA path + STATE/PERSISTENCE + MONETIZATION of "${name}" (${path}). Enumerate all services/api/lib modules, stores (redux/zustand), hooks that fetch or persist. For EACH: is it REAL (no mock/stub/hardcoded fake data), error-handled, and actually WIRED to a screen (not dead code)? Check: backend/online (Supabase/Colyseus/Realtime) wiring, save/load + offline, remote config/liveops, analytics events actually fire, ads (consent->load->show real), IAP (offerings->purchase->restore->entitlement unlock — no demo no-op in prod). Flag every stub/mock/unwired/incomplete path with file:line + severity. Write findings to ${SECT}/${name.toLowerCase()}-services.md.`,
  },
]

// ---------- Phase 1: audit (fan out per app) ----------
phase('Audit')
log('Audit all screens/APIs/features of Cipher + Vertex (parallel finders).')
const auditTasks = []
for (const [name, path] of Object.entries(APPS)) {
  for (const d of AUDIT_DIMS(name, path)) {
    auditTasks.push(() => agent(`${d.spec}
${ENV}
Be exhaustive and grounded (grep/read the real files). Output: the findings file written + a one-paragraph summary of the biggest gaps.`, { label: d.label, phase: 'Audit', agentType: 'general-purpose' }))
  }
}
// stagger 2+2
const a1 = await parallel(auditTasks.slice(0, 2))
const a2 = await parallel(auditTasks.slice(2))
const audits = [...a1, ...a2].filter(Boolean)

// ---------- Phase 2: fix (per app, reads its findings) ----------
phase('Fix')
log('Fix every confirmed incomplete/stubbed item to complete end-to-end.')
async function fixApp(name, path) {
  return agent(`Complete "${name}" (${path}) end-to-end by fixing the audit findings in ${SECT}/${name.toLowerCase()}-screens.md and ${SECT}/${name.toLowerCase()}-services.md (read both).
For EVERY confirmed incomplete item: wire dead buttons/actions to real handlers; replace stubs/mock/hardcoded-fake with REAL logic/services/data; add missing loading/error/empty states; complete half-finished flows so they work end-to-end; make user-visible placeholder/"coming soon" copy real or remove the element; ensure every screen is reachable and every service is wired. Do NOT introduce new stubs. Preserve the game's design + brand.
Prioritize BLOCKER/HIGH first, then MED. Leave a LOW only if fixing it is riskier than the gap; say which you deferred + why.
${ENV}
Loop \`npx tsc --noEmit\` (if runnable) to green. Output: each item fixed (file), what now works end-to-end, and anything deferred.`, { label: `${name}:fix`, phase: 'Fix', agentType: 'general-purpose' })
}
const fixes = (await parallel([
  () => fixApp('Vertex', APPS.Vertex),
  () => fixApp('Cipher', APPS.Cipher),
])).filter(Boolean)

// ---------- Phase 3: verify + report ----------
phase('Verify')
log('Re-audit fixed items + per-app completeness report.')
async function verifyApp(name, path) {
  return agent(`Verify "${name}" (${path}) is now COMPLETE end-to-end. Re-check the items from ${SECT}/${name.toLowerCase()}-*.md were actually fixed (not just claimed): every screen reachable + real, every service wired + real (no mock/stub in prod), core flows complete (game loop, onboarding, settings, modes, daily/streak, leaderboard, store/IAP, ads consent, online). Confirm \`tsc\` clean, no user-visible placeholders left.
Write a report file ${path}/AUDIT.md: per-area completeness (Screens, Flows, Services/APIs, Persistence, Online, Monetization, Ads, Polish) with ✅/🟡/❌ + one line, a 0-10 "production completeness" score, the residual items, and a clear "what still needs a device / live backend / store products to fully verify" section.
Output: the score, residual blockers, and confirmation AUDIT.md written.`, { label: `${name}:verify`, phase: 'Verify', agentType: 'code-reviewer' })
}
const reports = (await parallel([
  () => verifyApp('Vertex', APPS.Vertex),
  () => verifyApp('Cipher', APPS.Cipher),
])).filter(Boolean)

return { audits: audits.length, fixes: fixes.length, reports }
