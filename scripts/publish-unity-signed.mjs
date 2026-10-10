import { packUnitySigned } from "./pack-unity-signed.mjs";

// Reject before credentials are read or any archive/path reaches npm.
try { packUnitySigned(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
