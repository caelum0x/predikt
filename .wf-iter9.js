export const meta = {
  name: 'iterate-perf-bughunt',
  description: 'Iteration 9: performance (static: re-render/memoization/list virtualization) + real-bug hunt (races/leaks/unhandled promises) + dead-code removal, across Cipher/Vertex/Predikt. Verify.',
  phases: [
    { title: 'Develop' },
    { title: 'Verify' },
  ],
}

const CIPHER = '/Users/arhansubasi/expo games and apps/TheLock'
const VERTEX = '/Users/arhansubasi/expo games and apps/pillar-valley'
const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'
const ENV = `Headless: no device/profiler — runtime perf can't be measured here, so make STATIC perf improvements that are safe + real (memoization, stable callbacks/props, list virtualization/keys, avoid work in render, lazy/dynamic import of heavy modules) and HUNT for real correctness bugs. \`npx tsc --noEmit\` + tests only if node_modules exists. REAL only (no behavior change from perf edits — verify with tests). No secrets, GREENLIT intact. Report honestly if a target is already clean (don't invent work).`

phase('Develop')
log('Perf + real-bug + dead-code across Cipher/Vertex/Predikt.')

function work(name, path, notes) {
  return agent(`"${name}" (${path}) — PERFORMANCE + REAL-BUG + DEAD-CODE pass. Evaluate then improve, ONLY where real:
1) **Static perf:** find components that re-render unnecessarily or do work in render — add React.memo/useMemo/useCallback where it genuinely helps (stable props/handlers), fix inline object/array/function props passed to memoized children, ensure lists use stable keys + virtualization (FlashList/FlatList windowing) where long, and lazy/dynamic-import genuinely heavy modules. Do NOT over-memoize trivially; only where it removes real re-render/allocation.
2) **Real-bug hunt:** look for genuine correctness bugs — unhandled promise rejections, missing await, race conditions (stale closures/effect deps), memory leaks (uncleared timers/subscriptions/listeners), setState-after-unmount, off-by-one, and NaN/undefined paths. Fix the ones you can confirm are real.
3) **Dead code:** remove clearly-dead code you find (commented-out components, unused exports/imports/files) — only if provably unused.
${notes}
${ENV}
Output: perf changes (file + why it helps), real bugs fixed (file:line + the bug), dead code removed, tsc/test result. Be honest about what was ALREADY clean.`, { label: `${name.toLowerCase()}:perf`, phase: 'Develop', agentType: 'general-purpose' })
}

const cipher = () => work('Cipher', CIPHER, 'Focus: the game loop (PlayScreen/usePlaySession), timers/animations cleanup, the guess-grid render, and any AsyncStorage-in-render.')
const vertex = () => work('Vertex', VERTEX, 'Focus: the game canvas/render loop, leaderboard/feed lists, timer/subscription cleanup, and the zustand selectors (avoid re-render storms).')
const predikt = () => work('Predikt web', WEB, 'Focus: heavy contract/market pages + the on-chain trade box + feed lists (virtualization, memoization), effect-dep races in the on-chain hooks, and remove the dead commented-out banner components in components/nav/banner.tsx (DailyPrizeDrawingBanner / PrizeDrawing2Banner, ~lines 401-445).')

const b1 = await parallel([cipher, vertex])
const b2 = await parallel([predikt])
const done = [...b1, ...b2].filter(Boolean)

phase('Verify')
log('Verify iteration 9.')
const review = await agent(`Verify iteration 9 (perf + bug + dead-code) on Cipher (${CIPHER}), Vertex (${VERTEX}), Predikt web (${WEB}). For EACH:
- Perf changes are REAL (remove genuine re-renders/allocations; memoization applied where props/handlers are actually reused) and behavior-preserving (tests green).
- Real bugs fixed are genuine (confirm the bug existed: leak/race/unhandled-promise/NaN) — not cosmetic.
- Dead code removed was provably unused (esp. the Predikt banner); no live import broken.
- tsc clean, suites green, no secrets, GREENLIT intact, no behavior regressions.
Report per-app: perf wins, real bugs fixed, dead code removed, residual, a 0-10 quality-delta, and — honestly — whether the app is now at a plateau (little real work left) or the top 3 genuine items remaining.`, { label: 'verify', phase: 'Verify', agentType: 'code-reviewer' })

return { done: done.length, review }
