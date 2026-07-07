export const meta = {
  name: 'iterate-predikt-deemoji',
  description: 'Iteration 8: complete the Predikt web icon-first sweep — replace ALL emoji in the app own UI (components + pages) with vector icons, verifying every icon import exists so tsc stays green.',
  phases: [
    { title: 'Develop' },
    { title: 'Verify' },
  ],
}

const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'
const RULE = `ICON-FIRST: replace emoji glyphs in the app's OWN hardcoded rendered UI with VECTOR icons — use react-icons (Tb*) or the existing custom icon components already imported nearby; match the surrounding code. Give icons aria-hidden or an accessible label as fits. Rank/medal glyphs (🥉🥈🥇) → a trophy/medal vector with a rank tint or the existing rank component; 🔥 streak / 🧊 freeze / 💎 / 🎁 / ✅ ❌ / 📅 / 🏆 → semantic vector icons; toast \`{icon:'🎉'}\` → the toast lib's supported icon (a small vector node or an appropriate built-in) — don't break the toast API.
CRITICAL: every react-icons import you add MUST actually exist in the installed react-icons version (v5.3.0) — VERIFY each named import resolves (grep node_modules/react-icons/tb) before using it; do NOT introduce a missing-export like the prior TbHandshake break. Run \`npx tsc --noEmit\` iteratively and keep it at 0 errors.
Do NOT touch: emoji in analytics event-name strings, code comments, test files, or user-generated-content rendering (user messages/answers) — only the app's own UI glyphs.`
const ENV = `Headless: no device; \`npx tsc --noEmit\` + \`npx jest\` if node_modules exists. REAL only, no secrets, preserve behavior + GREENLIT.`

phase('Develop')
log('De-emoji Predikt web: components + pages (parallel, icon imports verified).')

const comps = () => agent(`Predikt web COMPONENTS (${WEB}/components) — replace ALL emoji in the app's own UI with vector icons. GREP components/ for emoji code points and fix every real rendered one. Known files: portfolio/balance-change-table.tsx (10+), contract/contract-info-dialog.tsx (🔎🏆🚫🕒✅❌), new-contract/market-preview.tsx (📅 x6), home/{daily-league-stat,quests-or-streak,daily-free-loan-modal,daily-predictle-stat}.tsx, feed/feed-bets.tsx (🤖), comments/comment-header.tsx (🤖), contract/react-button.tsx (🙄 toast), contract/{bountied-question,contract-leaderboard}.tsx (🏅), leagues/prizes-modal.tsx, wrapped/GeneralStats.tsx, site-activity.tsx, trust-panel.tsx, search.tsx (🎲⚽🍌), auth-context.tsx (🎉 toast), notification-settings.tsx (➡️). Handle each with the right vector icon.
${RULE}
${ENV}
Output: emoji replaced per file (count), icons used (confirm each import exists), tsc + jest result (0 errors, suite green).`, { label: 'i8:components', phase: 'Develop', agentType: 'general-purpose' })

const pages = () => agent(`Predikt web PAGES (${WEB}/pages) — replace ALL emoji in the app's own UI with vector icons. GREP pages/ for emoji code points and fix every real rendered one (charity.tsx, todo.tsx, shop.tsx, prize.tsx, predictle.tsx, wrapped.tsx, and any others). If a page is dead/vanity and slated for removal, still de-emoji it (don't delete pages here).
${RULE}
${ENV}
Output: emoji replaced per page (count), icons used (imports verified), tsc result (0 errors).`, { label: 'i8:pages', phase: 'Develop', agentType: 'general-purpose' })

const done = (await parallel([comps, pages])).filter(Boolean)

phase('Verify')
log('Verify Predikt web is emoji-free in its own UI + tsc green.')
const review = await agent(`Verify Predikt web icon-first sweep at ${WEB}.
- GREP components/ + pages/ for Unicode emoji code points in RENDERED JSX / UI string literals (exclude analytics event strings, comments, test files, and UGC rendering). Report the EXACT remaining count + any files — the goal is ZERO app-own UI emoji.
- Confirm replacements use real vector icons and every react-icons import RESOLVES (no missing-export; \`npx tsc --noEmit\` = 0 errors — run it).
- Confirm jest suite still green, no secrets, no behavior change, GREENLIT intact.
Report: emoji before->after count, any residual (with file:line + why), tsc/jest result, a 0-10 quality-delta, and the top 3 for the NEXT iteration.`, { label: 'verify', phase: 'Verify', agentType: 'code-reviewer' })

return { done: done.length, review }
