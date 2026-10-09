import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export function resolveDart() {
  const direct = process.env.DART || "dart";
  const probe = spawnSync(direct, ["--version"], { stdio: "ignore" });
  if (!probe.error && probe.status === 0) return { command: direct, windows: false };

  // Only the constant discovery command goes through CMD. Never interpolate
  // repository paths or environment values into a command string.
  const found = spawnSync("cmd.exe", ["/d", "/c", "where.exe dart"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (found.error || found.status !== 0) return undefined;
  for (const entry of found.stdout.trim().split(/\r?\n/)) {
    const directory = path.win32.dirname(entry);
    const candidates = [
      path.win32.join(directory, "dart.exe"),
      path.win32.join(directory, "cache", "dart-sdk", "bin", "dart.exe"),
    ];
    for (const native of candidates) {
      const command = process.platform === "linux" ? convertPath(native, "-u") : native;
      if (!existsSync(command)) continue;
      const check = spawnSync(command, ["--version"], { stdio: "ignore" });
      if (!check.error && check.status === 0) return { command, windows: true };
    }
  }
  return undefined;
}

export function runDart(dart, args, cwd) {
  const nativeArgs = dart.windows && process.platform === "linux" ? args.map((value) => convertPath(value, "-w")) : args;
  return spawnSync(dart.command, nativeArgs, { stdio: "inherit", cwd });
}

function convertPath(value, direction) {
  const result = spawnSync("wslpath", [direction, value], { encoding: "utf8" });
  return result.error || result.status !== 0 ? value : result.stdout.trim() || value;
}
