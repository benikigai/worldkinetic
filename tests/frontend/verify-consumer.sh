#!/bin/sh
# OUTSIDE_WRAPPER: focused client/shared/frontend-test gate. Whole-app diagnostics are reported separately.
set -eu
cd "$(dirname "$0")/../.."
python3 -B tests/frontend/verify_favicon.py
python3 -B tests/frontend/verify_landing.py
python3 -B tests/frontend/verify_guide.py
python3 -B tests/frontend/verify_consumer.py
./node_modules/.bin/tsx --test tests/frontend/*-acceptance.test.ts
./node_modules/.bin/tsc --project tests/frontend/tsconfig.frontend.json
npm run build
