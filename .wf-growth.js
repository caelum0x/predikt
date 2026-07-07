export const meta = {
  name: 'cipher-vertex-retention-virality',
  description: 'Retention + virality pass for Cipher + Vertex (the revenue lever): daily-result share cards (Wordle-style viral loop), streak/re-engagement push notifications, and ASO-optimized metadata. Static-verify.',
  phases: [
    { title: 'Growth' },
    { title: 'Verify' },
  ],
}

const APPS = {
  Vertex: '/Users/arhansubasi/expo games and apps/pillar-valley',
  Cipher: '/Users/arhansubasi/expo games and apps/TheLock',
}
const ENV = `Headless: NO device — push delivery + share-sheet + real ASO ranking can only be confirmed on a device/store; make the CODE + copy real and honest about that. No heavy fresh installs (tsc only if node_modules exists). REAL ONLY (no stub), no secrets, keep the game working, plain copy, icon-first.`

function growth(name, path, notes) {
  return agent(`Add a RETENTION + VIRALITY pass to "${name}" (${path}) — the actual revenue lever for a free-to-play game. Three parts:

1) **Daily-result SHARE CARDS (viral loop, à la Wordle).** After a daily/challenge result, let the player share a clean, SPOILER-FREE result card via the native share sheet:
   - Generate a shareable image (react-native-view-shot on a styled result view, OR a react-native-svg/canvas card) + a short text summary (score/streak/emoji-grid style — no answer spoilers) + a deep link back to today's challenge + a store link.
   - Wire a "Share" button on the result/game-over + daily screens. Use expo-sharing / RN Share. Deep link resolves to the app (scheme + universal link) or the store if not installed.
   - ${notes.share}

2) **Streak + re-engagement PUSH NOTIFICATIONS (retention).** Local notifications via expo-notifications (no server needed):
   - Daily streak reminder ("Your streak is at risk" / "Today's puzzle is live") scheduled for a sensible local time; cancels/reschedules on play.
   - Lapsed re-engagement (day 2 / day 3 / day 7 if not played) with plain copy.
   - Respect permission (request politely at the right moment, not on launch) + a Settings toggle to control categories; never spam. ${notes.push}

3) **ASO-optimized METADATA.** Write/refine an App Store + Play listing tuned for DISCOVERY (this is how a free game gets found): a keyword-optimized title + subtitle, a description that front-loads the hook + key features, a focused keyword set, a screenshots/app-preview PLAN (the 5-6 shots + captions that convert), category + age rating, and localization notes. Put it in ${path}/ASO.md (or extend the submission metadata file). Ground it in what the game actually is.

${ENV}
Reuse the game's existing components/state; don't duplicate. tsc where runnable.
Output: files added/changed, the share-card + push + ASO deliverables, and the tsc result.`, { label: `${name.toLowerCase()}-growth`, phase: 'Growth', agentType: 'general-purpose' })
}

phase('Growth')
log('Retention + virality: share cards + push + ASO for Cipher + Vertex.')
const done = (await parallel([
  () => growth('Vertex', APPS.Vertex, {
    share: 'Vertex is an endless game — share the run score + personal best + a tasteful visual, plus a "beat my score" challenge deep link.',
    push: 'Daily "come back and beat your best" + streak of consecutive-day plays; tie into the existing daily-run/quests if present.',
  }),
  () => growth('Cipher', APPS.Cipher, {
    share: 'Cipher has a DAILY puzzle — the strongest viral surface: share a spoiler-free emoji-grid result (guesses/streak) + a deep link to the daily puzzle (exactly the Wordle growth engine). Also a duel/challenge-a-friend share.',
    push: 'Daily-puzzle-live + streak-at-risk reminders (the daily loop is the retention core); lapsed re-engagement day 2/3/7.',
  }),
])).filter(Boolean)

phase('Verify')
log('Review the growth pass.')
const review = await agent(`Review the retention+virality pass on Cipher (${APPS.Cipher}) and Vertex (${APPS.Vertex}). For EACH confirm PASS/PARTIAL/FAIL + file:line:
- Share cards: a real shareable image/text is generated (not a stub), spoiler-free for the daily puzzle, wired to a Share button on the result/daily screen, with a working deep link + store fallback.
- Push: local streak + re-engagement notifications scheduled via expo-notifications, permission requested politely (not on cold launch), a Settings toggle exists, no spam; cancels on play.
- ASO: metadata is keyword-optimized + grounded (title/subtitle/keywords/description/screenshot plan), support/privacy URLs -> websites/ pages.
- No new stubs, no placeholder copy, tsc clean.
Give each a 0-10 "growth-readiness" score, residual items, and what needs a device/store to fully verify.`, { label: 'review', phase: 'Verify', agentType: 'code-reviewer' })

return { done: done.length, review }
