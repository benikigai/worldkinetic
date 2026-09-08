#!/bin/sh
# OUTSIDE_WRAPPER: preregistered supervisor acceptance command.
set -eu
cd "$(dirname "$0")/../.."
python3 tests/frontend/verify_favicon.py
python3 tests/frontend/verify_landing.py
./node_modules/.bin/tsx --test tests/frontend/*-acceptance.test.ts
npm run typecheck
npm run build
