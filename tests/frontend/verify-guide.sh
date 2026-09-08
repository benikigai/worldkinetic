#!/bin/sh
# OUTSIDE_WRAPPER: protected supervisor acceptance setup. Browser review remains separate.
set -eu
cd "$(dirname "$0")/../.."
python3 -B tests/frontend/verify_guide.py
sh tests/frontend/verify-live.sh
