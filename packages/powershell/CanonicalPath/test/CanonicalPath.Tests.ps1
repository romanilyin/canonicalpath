param(
    [Parameter(Mandatory = $true)][string] $RepoRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $RepoRoot 'packages/powershell/CanonicalPath/CanonicalPath.psd1'
Import-Module $modulePath -Force
$module = Get-Module CanonicalPath
$errorCodeCommand = $module.Invoke({ Get-Command Get-CanonicalErrorCode })

function Has-Property {
    param($Object, [string] $Name)
    return $null -ne $Object.PSObject.Properties[$Name]
}

function Require-Property {
    param($Object, [string] $Name)
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { throw ('missing required property ' + $Name) }
    return $property.Value
}

function Optional-Property {
    param($Object, [string] $Name, $Default = @{})
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Invoke-VectorCase {
    param($Case)

    switch ([string] $Case.operation) {
        'normalize' { return ConvertTo-CanonicalPath -Path (Require-Property $Case 'raw') -Options (Optional-Property $Case 'options') }
        'relative' { return Get-CanonicalRelativePath -Root (Require-Property $Case 'root') -Target (Require-Property $Case 'target') }
        'join' { return Join-CanonicalPath -Root (Require-Property $Case 'root') -Relative (Require-Property $Case 'relative') }
        'is-equal' { return [string] (Test-CanonicalPathEqual -Left (Require-Property $Case 'root') -Right (Require-Property $Case 'target') -Options (Optional-Property $Case 'options')).ToString().ToLowerInvariant() }
        'to-win32' { return ConvertTo-CanonicalWin32Path -Path (Require-Property $Case 'raw') }
        'to-wsl' { return ConvertTo-CanonicalWSLPath -Path (Require-Property $Case 'raw') -Options (Optional-Property (Optional-Property $Case 'options') 'wsl') }
        'to-posix' { return ConvertTo-CanonicalPosixPath -Path (Require-Property $Case 'raw') }
        'sanitize-component' { return ConvertTo-CanonicalComponent -Name (Require-Property $Case 'raw') -Profile (Require-Property $Case 'profile') }
        'encode-component' { return ConvertTo-CanonicalComponent -Name (Require-Property $Case 'raw') -Profile (Require-Property $Case 'profile') }
        'encode-git-ref' { return ConvertTo-CanonicalGitRef -Ref (Require-Property $Case 'raw') }
        default { throw ('unsupported vector operation ' + $Case.operation) }
    }
}

$testdataDir = Join-Path $RepoRoot 'spec/testdata'
$files = Get-ChildItem -Path $testdataDir -Filter '*_cases.json' | Sort-Object Name
$failures = New-Object System.Collections.ArrayList
$count = 0

foreach ($file in $files) {
    $vectors = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
    foreach ($case in $vectors.cases) {
        $count++
        $status = 'ok'
        $value = $null
        $errorCode = $null
        try {
            $value = Invoke-VectorCase $case
            if (Has-Property $case 'error') {
                [void] $failures.Add(($file.Name + ' ' + $case.id + ': expected error ' + $case.error + ', got value ' + $value))
                continue
            }
        } catch {
            $status = 'error'
            $errorCode = & $errorCodeCommand $_
            if (-not (Has-Property $case 'error')) {
                [void] $failures.Add(($file.Name + ' ' + $case.id + ': unexpected error ' + $errorCode + ': ' + $_.Exception.Message))
                continue
            }
        }

        if (Has-Property $case 'error') {
            if ($status -ne 'error' -or $errorCode -ne [string] $case.error) {
                [void] $failures.Add(($file.Name + ' ' + $case.id + ': expected error ' + $case.error + ', got ' + $errorCode))
            }
        } elseif (-not [string]::Equals([string] $value, [string] $case.expected, [System.StringComparison]::Ordinal)) {
            [void] $failures.Add(($file.Name + ' ' + $case.id + ': expected ' + $case.expected + ', got ' + $value))
        }
    }
}

if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Error $failure }
    throw ($failures.Count.ToString() + ' CanonicalPath vector test(s) failed')
}

Write-Host ('CanonicalPath PowerShell vectors passed: ' + $count)
