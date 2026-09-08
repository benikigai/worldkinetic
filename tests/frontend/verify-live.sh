#!/bin/sh
# OUTSIDE_WRAPPER: protected supervisor checks; fake HTTP is not live CAD or browser evidence.
set -eu
cd "$(dirname "$0")/../.."
python3 tests/frontend/verify_favicon.py
./node_modules/.bin/tsx --test tests/frontend/*-acceptance.test.ts
npm run typecheck
npm run build
