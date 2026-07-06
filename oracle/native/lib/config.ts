// Single source of truth for the Predikt web deployment the WebView shell wraps.
//
// DOMAIN is the bare host (no scheme). It is used for deep links and Apple/Android
// associated domains in app.config.js as well as for building web URLs below.
//
// EXPO_PUBLIC_WEB_URL overrides the production web origin at build/runtime so the
// shell can be pointed at any deployment without code changes. It must be a full
// origin with scheme and trailing slash, e.g. "https://predikt.app/".
//
// TODO(SHIP): replace REPLACE_WITH_DOMAIN with the real Predikt web domain before
// shipping. Keep DOMAIN, WEB_URL, DEV_WEB_URL and DOCS_URL consistent.

export const DOMAIN = 'REPLACE_WITH_DOMAIN'

// Full web origins (scheme + host + trailing slash) for the WebView shell.
export const WEB_URL =
  process.env.EXPO_PUBLIC_WEB_URL ?? `https://${DOMAIN}/`

export const DEV_WEB_URL = `https://dev.${DOMAIN}/`

// Docs origin used for the Terms of Service / Privacy Policy web views.
export const DOCS_URL = `https://docs.${DOMAIN}`
