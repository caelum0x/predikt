# Predikt Native — Firebase & Ship Setup

This is the SHIP note for the Predikt native app (Expo / React Native WebView
shell). Brand = **Predikt**, bundle id = **`com.predikt.app`**.

The repo intentionally contains **no secrets and no foreign (Manifold) identifiers**.
Several values are placeholders you MUST replace before building/shipping. This
document lists every one of them.

---

## 1. Firebase config (REQUIRED — not committed)

The Firebase config files contain **live API keys** and are therefore
**gitignored and NOT in the repo**. The previously committed files were
Manifold's live keys (`project_id: oracle` / `dev-oracle`,
`package_name: com.markets.manifold`) and have been removed.

You must create your **own** Predikt Firebase project and supply your own files.

### Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and create
   a project (e.g. `predikt`). Optionally create a second project for dev
   (e.g. `predikt-dev`).
2. Add an **Android app** with package name **`com.predikt.app`** and download
   its `google-services.json`.
3. Add an **iOS app** with bundle id **`com.predikt.app`** and download its
   `GoogleService-Info.plist`.

### Where to drop the files

Place them in the per-environment config dirs (these paths are gitignored):

```
configs/prod/google-services.json
configs/prod/GoogleService-Info.plist
configs/dev/google-services.json        # dev project, or reuse prod
configs/dev/GoogleService-Info.plist
```

`envscript.sh` copies the correct set into place based on
`NEXT_PUBLIC_FIREBASE_ENV` (`PROD` vs anything else). Android reads
`./google-services.json` at the native root (via `googleServicesFile` in
`app.config.js`); iOS reads `ios/Predikt/GoogleService-Info.plist`.

> `envscript.sh` must be run **after** `npx expo prebuild --clean`, because the
> `ios/Predikt/` directory only exists once prebuild has generated it.

---

## 2. Generated native dirs (`ios/` and `android/`)

`ios/` and `android/` are **prebuild-generated artifacts** derived from
`app.config.js` + `plugins/`. They were removed (they carried the old
`com.markets.manifold` / `manifold.markets` / `Manifold` names and a stale EAS
update URL) and are now **gitignored** (`/ios`, `/android`).

**Before building, always run:**

```bash
npx expo prebuild --clean
```

This regenerates `ios/` and `android/` correctly from the fixed config
(`com.predikt.app`, `predikt` scheme, the real `EAS_PROJECT_ID` update URL,
and the real `DOMAIN` for deep links / associated domains). Do not commit the
generated dirs.

---

## 3. Placeholders to replace before shipping

| Placeholder | Where | How to set |
|---|---|---|
| `REPLACE_WITH_DOMAIN` | `lib/config.ts`, `app.config.js` (`DOMAIN`) | Set env `EXPO_PUBLIC_WEB_DOMAIN` to the real Predikt web host (bare host, no scheme), e.g. `predikt.app`. Drives deep links + Apple/Android associated domains. |
| `EXPO_PUBLIC_WEB_URL` | consumed in `lib/config.ts` / `App.tsx` | **Must** be set to the real Predikt web deployment origin (full origin + trailing slash, e.g. `https://predikt.app/`) for OTA / deep-links / the WebView to load the live site. If unset it falls back to `https://<DOMAIN>/`. |
| `REPLACE_WITH_EAS_OWNER` | `app.config.js` (`owner`) | Set env `EAS_OWNER` to the Predikt EAS account/org that owns the project. (Was Manifold's `iansp` — removed.) |
| `REPLACE_WITH_EAS_PROJECT_ID` | `app.config.js` (`EAS_PROJECT_ID`) | Run `eas init`, then set env `EAS_PROJECT_ID` to the generated UUID. Needed for push tokens and the OTA update URL. |
| `REPLACE_WITH_SENTRY_ORG` | `app.config.js` (Sentry plugin) | Set to the Predikt Sentry org, or remove the Sentry plugin + `sentry.properties` + `Sentry.init` if error reporting isn't wired up. |
| `EXPO_PUBLIC_SENTRY_DSN` | `App.tsx` | Set to the real Predikt Sentry DSN, or leave unset (Sentry no-ops). |
| `REPLACE_WITH_APP_STORE_URL` | `common/src/envs/constants.ts` (`APPLE_APP_URL`) | Set to the real Predikt App Store listing once published. The Play URL already uses `com.predikt.app`. |

---

## 4. Ship checklist

1. Create the Predikt Firebase project(s); drop config files into `configs/{dev,prod}/`.
2. `eas init`; set `EAS_PROJECT_ID` and `EAS_OWNER`.
3. Set `EXPO_PUBLIC_WEB_DOMAIN` and `EXPO_PUBLIC_WEB_URL` to the real Predikt web deployment.
4. (Optional) Set Sentry org + DSN, or strip Sentry.
5. Replace `APPLE_APP_URL` once the App Store listing exists.
6. `npx expo prebuild --clean` to regenerate `ios/` and `android/`.
7. Run `envscript.sh` (via the existing build flow) to place the Firebase files.
8. Build with EAS.
