#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${CANONICALFS_DAEMON_URL:-http://127.0.0.1:8765}"
BASE_URL="${BASE_URL%/}"
TOKEN="${CANONICALFS_DAEMON_TOKEN:-}"
PYTHON_BIN="${PYTHON:-python3}"

usage() {
  cat >&2 <<'USAGE'
usage: canonicalfs.sh <op> [args...]

ops:
  health
  caps
  open-project <project_id> <host_root>
  close-project <project_id>
  mkdir-all <project_id> <path>
  write-text <project_id> <path> <text>
  read-text <project_id> <path> [max_bytes]
  stat <project_id> <path>
  remove <project_id> <path>
  rename <project_id> <path> <target>

Set CANONICALFS_DAEMON_URL and CANONICALFS_DAEMON_TOKEN for authenticated daemon calls.
USAGE
}

die() {
  printf '%s\n' "$1" >&2
  exit "${2:-1}"
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1" 69
}

require_token() {
  [[ -n "$TOKEN" ]] || die "CANONICALFS_DAEMON_TOKEN is required for this operation" 64
}

json_body() {
  "$PYTHON_BIN" - "$@" <<'PY'
import json
import sys

args = sys.argv[1:]
if len(args) % 2 != 0:
    raise SystemExit("json_body requires key/value pairs")
payload = {}
for index in range(0, len(args), 2):
    key = args[index]
    value = args[index + 1]
    if key == "max_bytes":
        payload[key] = int(value)
    else:
        payload[key] = value
print(json.dumps(payload, separators=(",", ":")))
PY
}

base64_text() {
  CANONICALFS_WRAPPER_TEXT="$1" "$PYTHON_BIN" - <<'PY'
import base64
import os

print(base64.b64encode(os.environ["CANONICALFS_WRAPPER_TEXT"].encode("utf-8")).decode("ascii"))
PY
}

parse_response() {
  local mode="$1"
  local status="$2"
  local file="$3"
  "$PYTHON_BIN" - "$mode" "$status" "$file" <<'PY'
import base64
import json
import sys

mode = sys.argv[1]
status = int(sys.argv[2])
file_path = sys.argv[3]

try:
    with open(file_path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception as exc:
    raise SystemExit(f"invalid daemon JSON response: {exc}")

error = data.get("error") if isinstance(data, dict) else None
if error:
    code = error.get("code", "ERR_DAEMON")
    message = error.get("message", "daemon error")
    print(f"{code}: {message}", file=sys.stderr)
    raise SystemExit(1)
if status >= 400:
    print(f"ERR_DAEMON: HTTP {status}", file=sys.stderr)
    raise SystemExit(1)

if mode == "none":
    raise SystemExit(0)
if mode == "json":
    print(json.dumps(data, separators=(",", ":")))
elif mode == "text":
    raw = data.get("data_base64", "")
    sys.stdout.write(base64.b64decode(raw).decode("utf-8"))
elif mode == "stat":
    print(json.dumps(data.get("stat"), separators=(",", ":")))
else:
    raise SystemExit(f"unsupported response mode: {mode}")
PY
}

request() {
  local method="$1"
  local path="$2"
  local mode="$3"
  local body="${4:-}"
  local tmp status parse_status
  tmp="$(mktemp)"

  local curl_args=(-sS -o "$tmp" -w "%{http_code}" -H "Accept: application/json")
  if [[ "$path" != "/healthz" ]]; then
    require_token
    curl_args+=(-H "Authorization: Bearer $TOKEN")
  fi
  if [[ "$method" == "POST" ]]; then
    curl_args+=(-X POST -H "Content-Type: application/json" --data "$body")
  fi
  curl_args+=("$BASE_URL$path")

  if ! status="$(curl "${curl_args[@]}")"; then
    rm -f "$tmp"
    die "daemon request failed: $method $path"
  fi

  parse_status=0
  parse_response "$mode" "$status" "$tmp" || parse_status=$?
  rm -f "$tmp"
  return "$parse_status"
}

need_command curl
need_command "$PYTHON_BIN"

OP="${1:-}"
if [[ -z "$OP" ]]; then
  usage
  exit 64
fi
shift

case "$OP" in
  health)
    [[ $# -eq 0 ]] || die "health takes no arguments" 64
    request GET /healthz json
    ;;
  caps)
    [[ $# -eq 0 ]] || die "caps takes no arguments" 64
    request GET /v1/caps json
    ;;
  open-project)
    [[ $# -eq 2 ]] || die "open-project requires project_id and host_root" 64
    request POST /v1/projects/open none "$(json_body project_id "$1" host_root "$2")"
    ;;
  close-project)
    [[ $# -eq 1 ]] || die "close-project requires project_id" 64
    request POST /v1/projects/close none "$(json_body project_id "$1")"
    ;;
  mkdir-all)
    [[ $# -eq 2 ]] || die "mkdir-all requires project_id and path" 64
    request POST /v1/fs/mkdirAll none "$(json_body project_id "$1" path "$2")"
    ;;
  write-text)
    [[ $# -eq 3 ]] || die "write-text requires project_id, path, and text" 64
    request POST /v1/fs/writeFile none "$(json_body project_id "$1" path "$2" data_base64 "$(base64_text "$3")")"
    ;;
  read-text)
    if [[ $# -eq 2 ]]; then
      request POST /v1/fs/readFile text "$(json_body project_id "$1" path "$2")"
    elif [[ $# -eq 3 ]]; then
      request POST /v1/fs/readFile text "$(json_body project_id "$1" path "$2" max_bytes "$3")"
    else
      die "read-text requires project_id, path, and optional max_bytes" 64
    fi
    ;;
  stat)
    [[ $# -eq 2 ]] || die "stat requires project_id and path" 64
    request POST /v1/fs/stat stat "$(json_body project_id "$1" path "$2")"
    ;;
  remove)
    [[ $# -eq 2 ]] || die "remove requires project_id and path" 64
    request POST /v1/fs/remove none "$(json_body project_id "$1" path "$2")"
    ;;
  rename)
    [[ $# -eq 3 ]] || die "rename requires project_id, path, and target" 64
    request POST /v1/fs/rename none "$(json_body project_id "$1" path "$2" target "$3")"
    ;;
  *)
    usage
    die "unknown op: $OP" 64
    ;;
esac
