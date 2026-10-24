// Compatibility entrypoint only. Local build/dependency code can persist a
// publisher in PATH, so this process must never read credentials, materialize
// npm configuration, or choose a local publisher on behalf of a maintainer.
// Keep refusal unconditional, including for ping, whoami and --dry-run.
console.error("Local npm token commands are disabled. Use the isolated GitHub OIDC trusted-publishing workflow documented in docs/release-process.md. No credentials are read and no npm process is started.");
process.exitCode = 1;
