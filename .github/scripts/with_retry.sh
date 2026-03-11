#!/bin/sh
# Shared retry helper sourced by GitHub Actions workflow steps.
#
# Usage:
#   . "$GITHUB_WORKSPACE/.github/scripts/with_retry.sh"
#   with_retry <command> [args…]
#
# Retries <command> up to 5 times with exponential back-off
# (15 s → 30 s → 60 s → 120 s).  Returns 1 if all attempts fail.
with_retry() {
  local max=5 attempt=1 delay=15
  until "$@"; do
    if [ "$attempt" -ge "$max" ]; then
      echo "All $max attempts failed." >&2
      return 1
    fi
    echo "Attempt $attempt/$max failed — retrying in ${delay}s…" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}
