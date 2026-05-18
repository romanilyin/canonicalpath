#!/usr/bin/env bash
set -euo pipefail

root="${TMPDIR:-/tmp}/cp-fixture"
rm -rf "$root"
mkdir -p "$root/project/safe" "$root/outside"
printf 'secret' > "$root/outside/secret.txt"
ln -s "$root/outside" "$root/project/link_out"
printf '%s\n' "$root"
