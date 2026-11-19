#!/bin/bash
set -euo pipefail
bash scripts/with-pinned-npm.sh exec --call 'node scripts/verify-runtime.mjs'
bash scripts/with-pinned-npm.sh ci --include=dev --ignore-scripts --prefer-offline --no-audit --no-fund
bash scripts/with-pinned-npm.sh run build
