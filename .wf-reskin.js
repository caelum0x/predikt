export const meta = {
  name: 'oracle-polymarket-reskin',
  description: 'Reskin the EXISTING oracle (Manifold) Next.js web app in place to a clean Polymarket-style UI — cards, market page, nav, browse grid — preserving all backend logic. Then typecheck + review.',
  phases: [
    { title: 'Reskin' },
    { title: 'Integrate' },
    { title: 'Review' },
  ],
}

const WEB = '/Users/arhansubasi/expo games and apps/prediction/oracle/web'

const HARD = `HARD RULES:
- This is the EXISTING Manifold codebase (MIT). EDIT FILES IN PLACE. Do NOT scaffold a new app, do NOT create a new project/folder, do NOT rewrite components from scratch. You may add a small helper component under web/components only when a reskin genuinely needs it.
- PRESERVE all backend logic, data fetching, hooks, props, and behavior. Change ONLY presentation: layout, Tailwind classes, spacing, structure of JSX, and which existing sub-parts show. Keep every existing import working; do not delete features.
- The color theme is ALREADY rethemed via CSS variables (primary=blue, yes=green, no=red, dark canvas). Use the existing Tailwind color tokens (bg-canvas-0/50/100, text-ink-*, primary-*, text-yes-600/bg-yes-*, text-no-600/bg-no-*). Do NOT hardcode hex colors.
- Target look: POLYMARKET. Clean, spacious, dark. Market cards with a prominent question and big YES/NO price buttons (green/red) showing cents (e.g. "Yes 63¢" / "No 37¢"), a compact footer (volume, traders, close time). Market page: big title, current probability + price chart, a YES/NO buy panel, positions, comments. Nav: simple, uncluttered.
- Do NOT run \`next build\`/\`next dev\` (needs backend env). You MAY run \`npx tsc --noEmit\` (it is slow on this big repo — scope your reasoning to the files you touched and keep types intact).
- Keep copy short and plain. Don't introduce new user-visible tech/product names.`

function reskin(label, spec) {
  return agent(`${spec}

Web app root: ${WEB} (Next.js pages router, Tailwind, TypeScript).
${HARD}
Output: the exact existing files you edited, a 1-line note per file on what changed visually, and confirmation you preserved logic/props.`, { label, phase: 'Reskin', agentType: 'general-purpose' })
}

phase('Reskin')
log('Reskin existing oracle/web to Polymarket — cards, market page, nav, browse grid (in place).')

const cards = () => reskin('market-cards', `Reskin the MARKET CARD + list rows to Polymarket style.
Primary file: web/components/contract/feed-contract-card.tsx (the main card, ~555 lines). Also the compact rows in web/components/contract/contracts-table.tsx and web/components/contract/contract-status-label / any small card used in grids (e.g. dashboard-market-card.tsx).
Make binary markets show two prominent buttons: a green YES with its price in cents and a red NO with its price in cents (derive from the contract probability; cents = round(prob*100)). Keep the existing bet actions wired (BetButton / the existing click handlers) — restyle them into these YES/NO buttons, don't remove the trading. Tighten the header (question prominent, creator + close/volume/traders as a compact muted footer using existing data). Rounded card (rounded-xl), bg-canvas-0, subtle border border-ink-200. Preserve multi-answer, poll, and numeric branches (just restyle their containers). Keep all props/hooks/imports.`)

const marketPage = () => reskin('market-page', `Reskin the MARKET (contract) PAGE to a Polymarket market page.
Find the page (web/pages/[username]/[contractSlug].tsx or similar) and its main layout components under web/components/contract/ (e.g. contract-page, contract-overview, the header, and the bet/trade panel components under web/components/bet/).
Layout: a big clear question title at top with the current probability shown large; the existing price CHART kept but given a clean framed container; a YES/NO BUY panel (reuse the existing bet input/execute components — do NOT reimplement trading) styled as a Polymarket trade box (Yes/No toggle green/red, amount, payout, buy button); the user's position summary; then comments. On wide screens put the trade panel in a right-hand column (sticky), chart+title on the left; stack on mobile. Preserve all existing data/logic/props.`)

const navGrid = () => reskin('nav-and-browse', `Reskin the NAV + BROWSE/HOME GRID to Polymarket style.
Files: web/components/nav/sidebar.tsx, web/components/nav/sidebar-item.tsx, web/components/nav/bottom-nav-bar.tsx, and the browse/home feed pages (web/pages/browse/* and/or web/pages/home/* and the component that renders the market list/grid, e.g. web/components/contract/contracts-table.tsx or a supabase-search results grid).
- Sidebar/bottom nav: cleaner, simpler, icon-forward, using primary-* for the active item, muted ink for inactive; keep all existing destinations and handlers.
- Browse/home: a clean market grid/list of the reskinned cards with a horizontal row of CATEGORY chips/tabs at the top (reuse the existing topic/category data + search hooks — do not fake). Prominent search entry. Spacious padding, dark canvas. Keep existing filtering/sorting/search logic intact; only restyle.`)

const b1 = await parallel([cards, marketPage])
const b2 = await parallel([navGrid])
const reskins = [...b1, ...b2].filter(Boolean)

phase('Integrate')
log('Typecheck the edited files + fix any breakage.')
const integrate = await agent(`Integrate the Polymarket reskin in ${WEB}.
Run \`npx tsc --noEmit\` (it's slow on this big repo — be patient; if it cannot finish, at least verify the specific files the reskin touched typecheck by reasoning + targeted checks). Fix every type/JSX error the reskin introduced WITHOUT removing behavior — reconcile prop/type mismatches, missing imports, and any className typos. Confirm no logic/data-fetching was dropped. Do NOT run next build/dev.
Output: tsc result (errors before->after or why it couldn't complete), files fixed, and a confirmation that trading/data flows are intact.`, { label: 'integrate', phase: 'Integrate', agentType: 'build-error-resolver' })

phase('Review')
log('Review the reskin.')
const review = await agent(`Review the Polymarket reskin of the existing Manifold web app at ${WEB}.
Check: (a) it EDITED existing components in place (no new app/scaffold), preserved backend logic/data/props; (b) market cards show clean green YES / red NO price buttons and the trade actions still work; (c) market page has title + chart + YES/NO buy panel + positions + comments in a Polymarket layout; (d) nav + browse grid are clean/dark/spacious with category tabs; (e) uses the theme tokens (no hardcoded hex), consistent dark Polymarket look; (f) no obvious broken imports or removed features.
Report a findings list (CRITICAL/HIGH/MED/LOW) with file:line, anything that lost functionality, and a 0-10 "Polymarket look + intact behavior" score.`, { label: 'review', phase: 'Review', agentType: 'code-reviewer' })

return { reskins: reskins.length, integrate, review }
