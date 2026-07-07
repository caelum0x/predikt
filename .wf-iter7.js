export const meta = {
  name: 'iterate-develop-iconfirst-web',
  description: 'Iteration 7: icon-first cleanup (replace emoji with vector symbols in Predikt web + Vertex push title) + websites a11y/SEO polish + a fresh evaluate sweep. Verify.',
  phases: [
    { title: 'Develop' },
    { title: 'Verify' },
  ],
}

const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'
const VERTEX = '/Users/arhansubasi/expo games and apps/pillar-valley'
const WEBSITES = '/Users/arhansubasi/expo games and apps/websites'
const ENV = `Headless: no device, disk may be tight — no heavy installs; \`npx tsc --noEmit\` + tests only if node_modules exists. REAL only, no secrets. Icon-first: vector symbols, NEVER emoji in shipped UI. Preserve behavior + GREENLIT compliance. Loop tsc + tests green.`

phase('Develop')
log('Icon-first emoji->vector (Predikt web + Vertex) + websites a11y/SEO.')

const predikt = () => agent(`Predikt web (${WEB}) — enforce the ICON-FIRST rule: replace emoji glyphs in user-visible components with vector symbols. Known offenders: components/home/daily-league-stat.tsx (🥉🥈🥇💎🏅), components/home/quests-or-streak.tsx (🧊🔥), components/home/daily-free-loan-modal.tsx (🎁✨), components/contract/bountied-question.tsx (🏅), components/contract/contract-leaderboard.tsx (🏅), components/leagues/prizes-modal.tsx (🥉🥈🥇💎), and any others — GREP the whole components/ + pages/ tree for emoji in rendered JSX/labels and replace them ALL.
- Use the app's existing icon system (react-icons Tb* or the custom SVG icon components already imported nearby) — match the surrounding code. Give each icon an appropriate accessible label/aria-hidden as fits.
- For medal/rank glyphs (🥉🥈🥇) use a trophy/medal vector + rank color, or the existing rank component if one exists. For 🔥 streak / 🧊 freeze / 💎 / 🎁 use semantic vector icons.
- Do NOT touch emoji in analytics event strings, comments, test files, or user-generated content rendering — only the app's OWN hardcoded UI glyphs.
${ENV} Output: emoji replaced (count + files), the icons used, tsc/jest result.`, { label: 'i7:predikt', phase: 'Develop', agentType: 'general-purpose' })

const websites = () => agent(`Websites (${WEBSITES}) — a11y + SEO polish on the generated pages (the generator is build.mjs; edit the TEMPLATES/helpers so all 5 apps + all pages benefit, then re-run \`node build.mjs\`).
- A11y: ensure a <main> landmark with id, a "skip to content" link, correct heading hierarchy (single h1/page), nav has aria-label, all links have discernible text, images/icons have alt/aria, sufficient color contrast note, and \`lang="en"\` present. Add aria-current to the active nav item.
- SEO: ensure per-page <title> + meta description are unique + good, canonical is correct, add JSON-LD (WebSite/Organization) on the index, and meta robots (index,follow) on marketing pages / noindex kept only where appropriate.
- Verify: run \`node build.mjs\` and confirm it regenerates cleanly (25 app pages + robots/sitemap/404); spot-check a couple of pages have the landmarks + skip link.
${ENV} Output: template changes, build result, what a11y/SEO items now pass.`, { label: 'i7:websites', phase: 'Develop', agentType: 'general-purpose' })

const vertex = () => agent(`Vertex (${VERTEX}) — small icon-first + evaluate sweep:
- Replace the "🔥" emoji in the push-notification title at src/api/notifications.ts (~line 163) with plain text or a vector-safe treatment (push titles can't render app vectors, so use plain words like "Daily Challenge" — no emoji per the strict icon-first rule).
- Then do a fresh EVALUATE sweep for any GENUINE user-visible issues you can see rendered: emoji in UI strings, leftover debug/dev text, placeholder/"coming soon", broken empty states. Fix only REAL ones (verify they render). Do NOT invent issues.
${ENV} Output: the notification fix, any real issues found+fixed (file:line), tsc/test result (keep suite green).`, { label: 'i7:vertex', phase: 'Develop', agentType: 'general-purpose' })

const b1 = await parallel([predikt, websites])
const b2 = await parallel([vertex])
const done = [...b1, ...b2].filter(Boolean)

phase('Verify')
log('Verify iteration 7.')
const review = await agent(`Verify iteration 7. Confirm PASS/PARTIAL/FAIL:
- Predikt web (${WEB}): NO emoji remain in the app's own hardcoded UI components (grep components/ + pages/ for emoji in rendered JSX — report any left); replacements use real vector icons with a11y; tsc + jest green.
- Websites (${WEBSITES}): generated pages have <main> landmark + skip link + single h1 + nav aria-label + lang + unique title/description + canonical + JSON-LD on index; \`node build.mjs\` regenerates cleanly.
- Vertex (${VERTEX}): the push-title emoji is gone; any other fixes are REAL (rendered) not invented; suite green + tsc clean.
- No regressions, no secrets, GREENLIT intact.
Report per-target: what landed (numbers), residual, 0-10 quality-delta, and top 3 for the NEXT iteration.`, { label: 'verify', phase: 'Verify', agentType: 'code-reviewer' })

return { done: done.length, review }
