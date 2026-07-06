/**
 * Next.js Edge Middleware — per-request Content Security Policy with nonce.
 *
 * WHY THIS EXISTS
 * ---------------
 * Static CSP headers (next.config.js `headers()`) must use 'unsafe-inline' /
 * 'unsafe-eval' for script-src because Next.js injects per-request inline
 * scripts (__NEXT_DATA__, hydration bootstrap, GTM init) whose content differs
 * on every render — making compile-time hashing impossible.
 *
 * This middleware generates a cryptographically-random base64 nonce on every
 * request and embeds it in the CSP. Next.js's render pipeline reads the nonce
 * from the *request* Content-Security-Policy header
 * (see node_modules/next/dist/server/render.js ~line 399 and
 * node_modules/next/dist/server/app-render/get-script-nonce-from-header.js)
 * and stamps nonce= on every inline <script> it generates — so we never need
 * 'unsafe-inline' in script-src.
 *
 * The same nonce is forwarded in the *response* CSP header so the browser
 * enforces it. _document.tsx reads it from the request header and passes it to
 * <NextScript> and the beforeInteractive init-theme <Script>, ensuring all
 * inline/bootstrapped scripts carry the correct nonce attribute.
 *
 * RESIDUALS (things that still require a broad allowance)
 * -------------------------------------------------------
 * 1. style-src 'unsafe-inline'
 *    The <style> blocks in _document.tsx (dark-mode flash prevention) and
 *    _app.tsx (CSS font variable) are rendered as inline <style> elements.
 *    Next.js does not propagate the nonce to <style> tags in the pages router,
 *    and Tailwind's JIT runtime (dev) also injects inline styles. Removing
 *    'unsafe-inline' from style-src would require wrapping every <style> with
 *    nonce={nonce} — a larger change deferred to a follow-up.
 *
 * 2. connect-src 'self' https: wss:
 *    Kept broad to allow Firebase, Supabase, amplitude, and RPC endpoints
 *    without enumerating every subdomain. Tighten by listing specific hosts
 *    once the full connection surface is audited.
 *
 * 3. img-src data: blob: https:
 *    User avatars, DALL-E images, Firebase Storage, imgur, and giphy all serve
 *    from different origins. The `images.remotePatterns` list in next.config.js
 *    covers <Image>, but raw <img> tags and CSS url() need the broad allowance.
 *
 * WHAT WAS REMOVED
 * ----------------
 * - 'unsafe-inline' from script-src  → replaced by 'nonce-{nonce}'
 * - 'unsafe-eval'   from script-src  → not needed in production Next.js builds
 *   (webpack eval() is dev-mode HMR only). If a third-party library breaks with
 *   a CSP violation for eval, add it back and document which package requires it.
 */

import { type NextRequest, NextResponse } from 'next/server'
import {
  normalizeRegion,
  REGION_COOKIE,
  REGION_HEADER,
} from 'web/lib/compliance/jurisdiction'

// Paths that should not have the nonce middleware applied (static assets, etc.)
// We apply to everything because next.config.js already excludes /_next/static.
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - /_next/static (static files)
     * - /_next/image (image optimization)
     * - /favicon.ico (favicon)
     * - Public folder assets that need no CSP (images, fonts)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf)).*)',
  ],
}

function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // btoa over the raw byte string — produces a URL-safe enough base64 for CSP
  return btoa(String.fromCharCode(...bytes))
}

/**
 * Read the visitor's region from the edge/CDN geo signal.
 *
 * SOFT COMPLIANCE AID — NOT LEGAL ADVICE. This feeds the jurisdiction-aware
 * money-mode layer (lib/compliance/jurisdiction.ts) so users default to the
 * appropriate mode for their area. Sources, in priority order:
 *   1. `request.geo?.country` — Vercel's parsed geo (set on Vercel/Edge).
 *   2. `x-vercel-ip-country`  — Vercel's raw geo header.
 *   3. `cf-ipcountry`         — Cloudflare's geo header.
 *   4. `x-country`            — generic CDN / reverse-proxy override.
 * Returns an uppercased ISO-3166 alpha-2 code, or null when unknown (in which
 * case the app applies its default-open policy: play money everywhere, on-chain
 * allowed unless the operator blocked the region).
 */
function readRegion(request: NextRequest): string | null {
  // `geo` is present on Vercel's edge runtime; guard for other hosts.
  const geoCountry = (request as { geo?: { country?: string } }).geo?.country
  const raw =
    geoCountry ??
    request.headers.get('x-vercel-ip-country') ??
    request.headers.get('cf-ipcountry') ??
    request.headers.get('x-country') ??
    undefined
  return normalizeRegion(raw)
}

export function middleware(request: NextRequest): NextResponse {
  const nonce = generateNonce()

  // Embed routes (/embed/*) are meant to be rendered inside third-party
  // <iframe>s across the open web, so they must NOT be frame-denied. Every
  // other route keeps the strict "frame-ancestors 'none'" + X-Frame-Options
  // DENY clickjacking protection.
  const isEmbed = request.nextUrl.pathname.startsWith('/embed')

  // script-src uses the per-request nonce. 'strict-dynamic' is intentionally
  // omitted because it is not compatible with script[src] tags without nonces
  // in older Next.js pages-router output; add it once all <script src> are
  // either nonce-bearing or loaded via next/script.
  const csp = [
    "default-src 'self'",
    // Nonce covers: Next.js bootstrap scripts, __NEXT_DATA__, GTM inline init,
    // and any <Script strategy="beforeInteractive"> loaded by _document.tsx.
    // analytics.umami.is is the Umami analytics script host (see _app.tsx).
    // www.googletagmanager.com is the GTM script loader host.
    `script-src 'self' 'nonce-${nonce}' https://analytics.umami.is https://www.googletagmanager.com`,
    // style-src: 'unsafe-inline' kept — see RESIDUALS above.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    // Embed widgets are framed anywhere; all other routes forbid framing.
    isEmbed ? 'frame-ancestors *' : "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')

  // Pass the CSP to the Next.js render pipeline via the REQUEST headers so
  // render.js can extract the nonce and stamp it on inline scripts.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('content-security-policy', csp)

  // Jurisdiction geo signal (soft compliance aid — NOT legal advice). Forward
  // the region on the REQUEST headers so SSR (_document/getServerSideProps) can
  // read it, independent of the nonce/CSP handling above.
  const region = readRegion(request)
  if (region) {
    requestHeaders.set(REGION_HEADER, region)
  } else {
    requestHeaders.delete(REGION_HEADER)
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })

  // Mirror the region onto the RESPONSE so the app can consume it: an
  // `x-predikt-region` header (for edge/proxy consumers) and a non-HttpOnly
  // cookie the client reads synchronously to gate the on-chain UI. The cookie
  // carries no PII beyond a country code and is safe to expose to JS.
  if (region) {
    response.headers.set(REGION_HEADER, region)
    response.cookies.set(REGION_COOKIE, region, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      maxAge: 60 * 60 * 24, // refresh daily so a moved user re-geolocates
    })
  }

  // Set all security headers on the RESPONSE for the browser.
  response.headers.set('Content-Security-Policy', csp)
  // X-Frame-Options has no "allow any origin" value, so for embeds we omit it
  // entirely and rely on the CSP "frame-ancestors *" above. Non-embed routes
  // keep the DENY guard.
  if (isEmbed) {
    response.headers.delete('X-Frame-Options')
  } else {
    response.headers.set('X-Frame-Options', 'DENY')
  }
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  return response
}
