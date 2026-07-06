#!/usr/bin/env bash
#
# Copies the correct Firebase config for the target environment into place.
#
# IMPORTANT: run this AFTER `npx expo prebuild --clean` — the iOS project dir
# (ios/Predikt) only exists once prebuild has generated it from app.config.js
# (expo.name = "Predikt"). The generated ios/ and android/ dirs are gitignored.
#
# Firebase config files are NOT committed (they contain live API keys). You must
# supply your own Predikt Firebase config files first — see FIREBASE-SETUP.md.
# Expected inputs:
#   configs/dev/google-services.json   + configs/dev/GoogleService-Info.plist
#   configs/prod/google-services.json  + configs/prod/GoogleService-Info.plist

set -euo pipefail

# iOS project dir is derived from the Expo app name (expo.name in app.config.js).
# Keep this in sync if the app name changes.
IOS_PROJECT_DIR="ios/Predikt"

if [ "${NEXT_PUBLIC_FIREBASE_ENV:-}" == "PROD" ]; then
  echo "Switching to Firebase Production environment"
  SRC="configs/prod"
else
  echo "Switching to Firebase Dev environment"
  SRC="configs/dev"
fi

# google-services.json goes to the native project root (android reads
# ./google-services.json via app.config.js googleServicesFile).
cp -a "$SRC/google-services.json" ./google-services.json

# GoogleService-Info.plist goes into the generated iOS project dir.
if [ -d "$IOS_PROJECT_DIR" ]; then
  cp -a "$SRC/GoogleService-Info.plist" "$IOS_PROJECT_DIR/GoogleService-Info.plist"
else
  echo "WARN: $IOS_PROJECT_DIR not found — run 'npx expo prebuild --clean' first." >&2
fi
