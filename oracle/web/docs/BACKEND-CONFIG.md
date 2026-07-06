# Backend config you must set

The committed environment configs in
[`oracle/common/src/envs/prod.ts`](../../common/src/envs/prod.ts) and
[`oracle/common/src/envs/dev.ts`](../../common/src/envs/dev.ts) still carry the
**upstream** Firebase and Supabase values. During the rebrand, some identifiers
were changed to `oracle`/`dev-oracle` while the committed `apiKey` and
`supabaseAnonKey` were left as the original upstream project's values. This is
incoherent: **authentication will fail** until every field below points at a
single, real backend project that you own.

Do not deploy with the placeholder values. Replace them with your own free-tier
Firebase and Supabase projects.

## Firebase (`firebaseConfig`)

Where to get these: [Firebase console](https://console.firebase.google.com/) →
your project → **Project settings** → **General** → *Your apps* → *SDK setup and
configuration* (Config). Firebase's Spark plan (free tier) is sufficient to
start.

| Field | What it is | Notes |
| --- | --- | --- |
| `apiKey` | Web API key | Currently an upstream value — **must** be your project's key. |
| `authDomain` | `<your-project>.firebaseapp.com` | Must match your Firebase project. |
| `projectId` | Firebase project id | Set to `oracle`/`dev-oracle` during rebrand — replace with your **real** project id. |
| `storageBucket` | `<your-project>.appspot.com` | Must match your project. |
| `privateBucket` | Your private GCS bucket name | Optional; only if you use it. |
| `messagingSenderId` | Sender id | From the same config block. |
| `appId` | Firebase app id | From the same config block. |
| `measurementId` | Analytics measurement id | Optional (Google Analytics). |

Set these in **both** `prod.ts` and `dev.ts` (dev spreads `PROD_CONFIG` but
overrides `firebaseConfig` — set both to your prod and dev Firebase projects
respectively).

## Supabase (`supabaseInstanceId`, `supabaseAnonKey`)

Where to get these: [Supabase dashboard](https://supabase.com/dashboard) → your
project → **Project Settings** → **API**. The free tier is sufficient to start.

| Field | What it is | Notes |
| --- | --- | --- |
| `supabaseInstanceId` | Project ref (the subdomain in `<ref>.supabase.co`) | Currently an upstream ref — replace with yours. |
| `supabaseAnonKey` | The **anon**/public API key (JWT) | Public by design (row-level security enforces access), but it must be **your** project's anon key, not the upstream one. |

Set these in **both** `prod.ts` and `dev.ts`.

## Related (not this fix, but check them too)

`apiEndpoint`, `cloudRunId`/`cloudRunRegion`, `twitchBotEndpoint`,
`googleAnalyticsId`, and `expoConfig.*` OAuth client ids also carry upstream
values. Point them at your own deployed backend / OAuth clients before shipping.

## Sanity check

After replacing values, confirm that:

- The `apiKey`/`authDomain`/`projectId`/`storageBucket` in `firebaseConfig` all
  belong to the **same** Firebase project.
- `supabaseInstanceId` and `supabaseAnonKey` belong to the **same** Supabase
  project.
- Sign-in works end to end (create account, log in) — this is what breaks when
  the fields are mismatched.
