// Server-side authentication for the AI API routes (SERVER-ONLY).
//
// The web app ships only the CLIENT Firebase SDK — there is no firebase-admin
// service account available in this Next.js runtime. To verify a caller's
// Firebase ID token without inventing a new auth scheme, we validate the token
// against Firebase's Identity Toolkit REST endpoint (accounts:lookup) using the
// PUBLIC web API key from FIREBASE_CONFIG. That API key is a public client value
// (already baked into the browser bundle) — it is NOT a secret. Firebase itself
// checks the token's signature/expiry/audience, so a forged or expired token is
// rejected upstream.
//
// The ID token is read from either:
//   1. the `Authorization: Bearer <idToken>` header, or
//   2. the app's existing Firebase auth cookie (AUTH_COOKIE_NAME), whose value
//      is the serialized Firebase user (User.toJSON()) containing
//      `stsTokenManager.accessToken` — the same cookie server-auth.ts reads.
//
// This means same-origin authenticated browser requests work automatically (the
// browser sends the cookie), with zero client changes, and Bearer-token callers
// (e.g. native) are also supported.

import type { NextApiRequest } from 'next'
import { FIREBASE_CONFIG } from 'common/envs/constants'
import { AUTH_COOKIE_NAME } from 'common/envs/constants'
import { getCookiesFromString } from 'web/lib/util/cookie'

const IDENTITY_TOOLKIT_LOOKUP_URL =
  'https://identitytoolkit.googleapis.com/v1/accounts:lookup'

// How long to wait on the Firebase verification call before giving up.
const VERIFY_TIMEOUT_MS = 5000

export type AuthedUser = { uid: string }

// Extract the raw ID token from the Authorization header, if present.
function tokenFromAuthHeader(req: NextApiRequest): string | null {
  const header = req.headers.authorization
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

// Shape of the relevant slice of a serialized Firebase user (User.toJSON()).
type SerializedFirebaseUser = {
  stsTokenManager?: { accessToken?: unknown }
}

// Extract the ID token from the Firebase auth cookie, if present.
function tokenFromAuthCookie(req: NextApiRequest): string | null {
  const cookieHeader = req.headers.cookie
  if (!cookieHeader) return null
  const raw = getCookiesFromString(cookieHeader)[AUTH_COOKIE_NAME]
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const accessToken = (parsed as SerializedFirebaseUser).stsTokenManager
    ?.accessToken
  return typeof accessToken === 'string' && accessToken.length > 0
    ? accessToken
    : null
}

type LookupResponse = {
  users?: Array<{ localId?: unknown }>
}

// Verify the ID token with Firebase and return the uid, or null if invalid.
async function verifyIdToken(idToken: string): Promise<string | null> {
  const apiKey = FIREBASE_CONFIG.apiKey
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${IDENTITY_TOOLKIT_LOOKUP_URL}?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: controller.signal,
      }
    )
    if (!res.ok) return null
    const data: unknown = await res.json()
    const users = (data as LookupResponse).users
    const uid = Array.isArray(users) ? users[0]?.localId : undefined
    return typeof uid === 'string' && uid.length > 0 ? uid : null
  } catch {
    // Network/abort/parse failure — treat as unauthenticated (fail closed).
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// Returns the authenticated user for the request, or null if the caller is not
// signed in (missing/invalid token). Callers should respond with 401 on null.
export async function getAuthedUser(
  req: NextApiRequest
): Promise<AuthedUser | null> {
  const idToken = tokenFromAuthHeader(req) ?? tokenFromAuthCookie(req)
  if (!idToken) return null
  const uid = await verifyIdToken(idToken)
  return uid ? { uid } : null
}
