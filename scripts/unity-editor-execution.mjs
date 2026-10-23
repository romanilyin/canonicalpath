import { readFileSync } from "node:fs";

const quotePowerShell = value => `'${String(value).replaceAll("'", "''")}'`;

// A GUI executable launched with PowerShell's call operator may return before
// it exits. Keep the process handle, wait, and propagate its actual exit code.
export function unityPowerShellCommand(editor, args, workingDirectory) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$startInfo = [System.Diagnostics.ProcessStartInfo]::new()",
    `$startInfo.FileName = ${quotePowerShell(editor)}`,
    `$startInfo.WorkingDirectory = ${quotePowerShell(workingDirectory)}`,
    "$startInfo.UseShellExecute = $false",
    "$startInfo.RedirectStandardOutput = $true",
    "$startInfo.RedirectStandardError = $true",
    ...args.map(value => `$startInfo.ArgumentList.Add(${quotePowerShell(value)})`),
    "$editorProcess = [System.Diagnostics.Process]::new()",
    "$editorProcess.StartInfo = $startInfo",
    "try { if (-not $editorProcess.Start()) { throw 'Unity Editor did not start' }; $stdout = $editorProcess.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput()); $stderr = $editorProcess.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError()); $editorProcess.WaitForExit(); [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($stdout, $stderr)); $editorStatus = $editorProcess.ExitCode } finally { $editorProcess.Dispose() }",
    "exit $editorStatus",
  ].join("; ");
}

// Exit zero alone does not prove that Unity compiled or invoked our runner.
// A fresh nonce is emitted only after every assertion in this invocation ran.
export function requireUnityCompletion(result, receiptFile, expectedNonce) {
  if (result.error) throw new Error(`Unity Editor could not run: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) throw new Error(`Unity Editor exited with ${result.status ?? result.signal ?? "unknown status"}`);
  let receipt;
  try { receipt = readFileSync(receiptFile, "utf8"); }
  catch (error) { throw new Error(`Unity runner did not produce its completion receipt: ${receiptFile}`, { cause: error }); }
  if (receipt !== expectedNonce) throw new Error(`Unity runner completion receipt does not match this invocation: ${receiptFile}`);
}
