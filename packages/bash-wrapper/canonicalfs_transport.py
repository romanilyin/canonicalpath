"""Bound decoded curl output before it can reach the response file or JSON parser."""
import math
import os
import signal
import subprocess
import sys
import re
from urllib.parse import urlsplit


def interrupted(_signal, _frame):
    raise InterruptedError("daemon request interrupted")


def main():
    destination = sys.argv[1]
    arguments_in = sys.argv[2:]
    try:
        endpoint = arguments_in[arguments_in.index("--url") + 1]
        parsed = urlsplit(endpoint)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment or any(ord(c) <= 32 or ord(c) == 127 for c in endpoint):
            raise ValueError()
    except (ValueError, IndexError):
        raise SystemExit("ERR_DAEMON: daemon endpoint must be HTTPS without credentials, query or fragment")
    pin = os.environ.get("CANONICALFS_TLS_PUBLIC_KEY_PIN", "")
    if not re.fullmatch(r"sha256//[A-Za-z0-9+/]{43}=", pin):
        raise SystemExit("ERR_DAEMON: a trusted CANONICALFS_TLS_PUBLIC_KEY_PIN is required")
    try:
        limit = int(os.environ.get("CANONICALFS_MAX_RESPONSE_BYTES", "25165824"))
        timeout = float(os.environ.get("CANONICALFS_TIMEOUT_SECONDS", "30"))
        if not 1 <= limit <= 25165824 or not math.isfinite(timeout) or not 0 < timeout <= 30:
            raise ValueError()
    except ValueError:
        raise SystemExit("ERR_DAEMON: local limits must be positive and cannot exceed 24 MiB or 30 seconds")
    config = sys.stdin.buffer.read()
    environment = dict(os.environ)
    environment.pop("CANONICALFS_DAEMON_TOKEN", None)
    arguments = ["curl", "--disable", "--config", "-", "--silent", "--show-error", "--compressed",
                 "--proto", "=https", "--proto-redir", "=https", "--tlsv1.2", "--pinnedpubkey", pin,
                 "--max-time", str(timeout), "--connect-timeout", str(min(timeout, 10)),
                 "--max-filesize", str(limit), "--output", "-", "--write-out", "%{http_code}"]
    ca_file = os.environ.get("CANONICALFS_TLS_CA_FILE")
    if ca_file:
        arguments.extend(["--cacert", ca_file])
    # No proxy, user curlrc, redirect following, --insecure or public trust bootstrap.
    arguments.extend(["--noproxy", "*", *arguments_in])
    process = subprocess.Popen(arguments, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, env=environment)
    try:
        process.stdin.write(config)
        process.stdin.close()
        total = 0
        with open(destination, "w+b") as output:
            while True:
                chunk = process.stdout.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                # curl appends a three-byte HTTP status after the decoded body.
                # No more than limit + 3 bytes are ever persisted.
                if total > limit + 3:
                    raise SystemExit("ERR_RESPONSE_TOO_LARGE: daemon response exceeds local byte limit")
                output.write(chunk)
            code = process.wait()
            if code == 63:
                raise SystemExit("ERR_RESPONSE_TOO_LARGE: daemon response exceeds local byte limit")
            if code != 0:
                raise SystemExit("ERR_DAEMON: daemon request failed or timed out")
            if total < 3:
                raise SystemExit("ERR_DAEMON: missing daemon HTTP status")
            output.seek(-3, os.SEEK_END)
            status = output.read(3)
            if not status.isdigit():
                raise SystemExit("ERR_DAEMON: invalid daemon HTTP status")
            output.truncate(total - 3)
            sys.stdout.write(status.decode("ascii"))
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        process.stdout.close()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except (KeyboardInterrupt, InterruptedError):
        raise SystemExit("ERR_DAEMON: daemon request interrupted")
