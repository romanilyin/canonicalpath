"""Bound decoded curl output before it can reach the response file or JSON parser."""
import math
import os
import signal
import subprocess
import sys


def interrupted(_signal, _frame):
    raise InterruptedError("daemon request interrupted")


def main():
    destination = sys.argv[1]
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
    arguments = ["curl", "--config", "-", "--silent", "--show-error", "--compressed",
                 "--max-time", str(timeout), "--connect-timeout", str(min(timeout, 10)),
                 "--max-filesize", str(limit), "--output", "-", "--write-out", "%{http_code}", *sys.argv[2:]]
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
