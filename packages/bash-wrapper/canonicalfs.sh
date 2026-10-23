#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${CANONICALFS_DAEMON_URL:-https://127.0.0.1:8765}"
BASE_URL="${BASE_URL%/}"
TOKEN="${CANONICALFS_DAEMON_TOKEN:-}"
# Do not propagate the bearer (or the retired payload variable) to helpers.
# The caller is responsible for provisioning its initial token environment.
export -n TOKEN
unset CANONICALFS_DAEMON_TOKEN CANONICALFS_WRAPPER_TEXT
PYTHON_BIN="${PYTHON:-python3}"
TRANSPORT_HELPER="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/canonicalfs_transport.py"
# Wait for the request subshell's EXIT cleanup before the CLI exits on a
# process-group signal. Otherwise the caller can observe a leftover file while
# that child is still completing its signal handler.
trap 'wait; exit 130' INT
trap 'wait; exit 143' TERM HUP

usage() {
  cat >&2 <<'USAGE'
usage: canonicalfs.sh <op> [args...]

ops:
  health
  caps
  open-project <project_id> <host_root>
  close-project <project_id>
  mkdir-all <project_id> <path>
  write-text <project_id> <path>  (UTF-8 text on stdin)
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

write_text_body() {
  # Static Python code is supplied with -c so stdin remains exclusively the
  # payload channel. Encode before Bash sees the bytes, preserving NUL and all
  # trailing newlines without putting text/base64 in child argv or environment.
  "$PYTHON_BIN" -c '
import base64
import json
import sys

limit = 1 << 20
raw = sys.stdin.buffer.read(limit + 1)
if len(raw) > limit:
    raise SystemExit("write-text input exceeds the 1 MiB limit")
try:
    raw.decode("utf-8", errors="strict")
except UnicodeDecodeError:
    raise SystemExit("write-text input must be valid UTF-8")
payload = json.dumps({"project_id": sys.argv[1], "path": sys.argv[2],
                      "data_base64": base64.b64encode(raw).decode("ascii")},
                     separators=(",", ":"))
if len(payload.encode("utf-8")) > limit:
    raise SystemExit("write-text encoded request exceeds the 1 MiB limit")
sys.stdout.write(payload)
' "$1" "$2"
}

write_text() {
  local body
  export -n body
  body="$(write_text_body "$1" "$2")" || return $?
  request POST /v1/fs/writeFile none "$body"
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
if status < 200 or status >= 300:
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

request() (
  local method="$1"
  local path="$2"
  local mode="$3"
  local body="${4:-}"
  export -n body
  local tmp_dir tmp body_file status parse_status config="" escaped_token=""
  export -n config escaped_token
  local curl_args=(-H "Accept: application/json")
  if [[ "$path" != "/healthz" ]]; then
    require_token
    [[ "$TOKEN" != *$'\n'* && "$TOKEN" != *$'\r'* ]] || die "token contains a line break"
    escaped_token="${TOKEN//\\/\\\\}"
    escaped_token="${escaped_token//\"/\\\"}"
    printf -v config 'header = "Authorization: Bearer %s"\n' "$escaped_token"
  fi
  umask 077
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/canonicalfs-request.XXXXXXXX")"
  tmp="$tmp_dir/response.json"
  body_file="$tmp_dir/request.json"
  trap 'rm -f -- "$body_file" "$tmp"; rmdir -- "$tmp_dir"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  : > "$tmp"
  if [[ "$method" == "POST" ]]; then
    printf '%s' "$body" > "$body_file"
    curl_args+=(-X POST -H "Content-Type: application/json" --data-binary "@$body_file")
  fi
  curl_args+=(--url "$BASE_URL$path")

  if ! status="$(printf '%s' "$config" | "$PYTHON_BIN" "$TRANSPORT_HELPER" "$tmp" "${curl_args[@]}")"; then
    die "daemon request failed: $method $path"
  fi

  parse_status=0
  parse_response "$mode" "$status" "$tmp" || parse_status=$?
  return "$parse_status"
)

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
    [[ $# -eq 2 ]] || die "write-text requires project_id and path; pass UTF-8 text on stdin" 64
    write_text "$1" "$2"
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
