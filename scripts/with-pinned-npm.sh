#!/bin/bash
set -euo pipefail
# The platform may perform a preliminary install with its own npm. Our supported
# install/build uses this exact package-manager version and the committed lock.
if [ "$(npm --version)" = "10.9.4" ]; then
  exec npm "$@"
fi
exec npx --yes --package=npm@10.9.4 -- npm "$@"
