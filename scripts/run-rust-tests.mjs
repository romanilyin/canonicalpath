import path from "node:path";
import { repositoryRoot, requireCargo, runCargo } from "./rust-toolchain.mjs";

runCargo(requireCargo(), ["test", "--locked", "--manifest-path", path.join(repositoryRoot, "packages", "rust", "Cargo.toml")]);
console.log("Rust CanonicalPath unit and documentation tests passed");
