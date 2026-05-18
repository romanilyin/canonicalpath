import { join, normalize, relative, toWin32 } from "@romanilyin/canonicalpath-standalone";

const root = normalize("/repo/src/..");
const target = normalize("/repo/src/file.txt");
const rel = relative(root, target);
const joined = join(root, rel);
const win32 = toWin32(normalize("C:\\Repo\\README.md"));

if (root !== "/repo") throw new Error(`unexpected root: ${root}`);
if (rel !== "src/file.txt") throw new Error(`unexpected relative path: ${rel}`);
if (joined !== "/repo/src/file.txt") throw new Error(`unexpected joined path: ${joined}`);
if (win32 !== "C:\\Repo\\README.md") throw new Error(`unexpected Win32 serialization: ${win32}`);
