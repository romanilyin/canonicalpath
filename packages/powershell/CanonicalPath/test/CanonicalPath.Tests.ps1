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
$files = @(Get-ChildItem -Path $testdataDir -Filter '*_cases.json' | Sort-Object Name) + @(Get-Item -LiteralPath (Join-Path $testdataDir 'git-ref-utf16-vectors.json'))
$failures = New-Object System.Collections.ArrayList
$count = 0

foreach ($file in $files) {
    $vectors = Get-Content -LiteralPath $file.FullName -Encoding UTF8 -Raw | ConvertFrom-Json
    foreach ($case in $vectors.cases) {
        if (Has-Property $case 'rawUtf16') {
            $raw = New-Object System.Text.StringBuilder
            foreach ($code in $case.rawUtf16) { [void] $raw.Append([char][int]$code) }
            $case | Add-Member -NotePropertyName 'raw' -NotePropertyValue $raw.ToString()
        }
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


# Operation chains exercise persisted identity, not just isolated vector results.
$nativeOptions = @{ sourceHost = 'posix' }
$canonicalOptions = @{ sourceHost = 'canonical' }
foreach ($raw in @('/repo/a\b', '/C:/repo', 'C:foo', './C:/repo', 'x/../C:foo', 'file://repo/a')) {
    $once = ConvertTo-CanonicalPath $raw $nativeOptions
    if (-not [string]::Equals((ConvertTo-CanonicalPath $once $nativeOptions), $once, [StringComparison]::Ordinal) -or -not [string]::Equals((ConvertTo-CanonicalPath $once $canonicalOptions), $once, [StringComparison]::Ordinal)) { throw ('native/canonical idempotence: ' + $raw) }
}
foreach ($pair in @(@('/repo', '/repo/a\b'), @('/repo', '/repo/C:foo'), @('c:/repo', 'c:/repo/C:foo'), @('//?/UNC/server/share', '//?/UNC/server/share/repo'))) {
    if (-not [string]::Equals((Join-CanonicalPath $pair[0] (Get-CanonicalRelativePath $pair[0] $pair[1])), $pair[1], [StringComparison]::Ordinal)) { throw ('relative/join chain: ' + $pair[1]) }
}
foreach ($mount in @('/', '', '/foo/../mnt/./', '/mnt\vol', '/C:/drives')) {
    $wslOptions = @{ enabled = $true; mountRoot = $mount }
    $hostPath = ConvertTo-CanonicalWSLPath 'c:/repo/file' $wslOptions
    if (-not [string]::Equals((ConvertTo-CanonicalPath $hostPath @{ sourceHost = 'wsl'; wsl = $wslOptions }), 'c:/repo/file', [StringComparison]::Ordinal)) { throw ('WSL round trip: ' + $mount) }
}

# PowerShell's case-sensitive comparison operators still use linguistic
# equality. Canonical components, roots, and dot tokens require ordinal checks.
$composed = 'caf' + [char] 0x00e9
$decomposed = 'cafe' + [char] 0x0301
$rejected = $false
try { Get-CanonicalRelativePath ('//' + $composed + '/share') ('//' + $decomposed + '/share/file') } catch { $rejected = (& $errorCodeCommand $_) -eq 'ERR_OUTSIDE_ROOT' }
if (-not $rejected) { throw 'Unicode-equivalent UNC roots were treated as identical' }
$ignorable = [string] [char] 0x00ad
foreach ($component in @(('.' + $ignorable), ('..' + $ignorable))) {
    $path = '/repo/' + $component + '/file'
    if (-not [string]::Equals((ConvertTo-CanonicalPath $path $nativeOptions), $path, [StringComparison]::Ordinal)) { throw 'literal Unicode component was interpreted as a dot segment' }
}
$relativeRoot = '.' + $ignorable
if (-not [string]::Equals((Join-CanonicalPath $relativeRoot 'file'), ($relativeRoot + '/file'), [StringComparison]::Ordinal)) { throw 'literal relative root was interpreted as dot' }
$unicodeMount = '/' + $ignorable
if (-not [string]::Equals((ConvertTo-CanonicalWSLPath 'c:/repo' @{ mountRoot = $unicodeMount }), ($unicodeMount + '/c/repo'), [StringComparison]::Ordinal)) { throw 'literal Unicode mount root was interpreted as slash' }

$rawRelative = $module.Invoke({ Get-Command ConvertTo-CanonicalRelativePath })
$rejected = $false
try { & $rawRelative 'a\b' } catch { $rejected = (& $errorCodeCommand $_) -eq 'ERR_INVALID_PATH' }
if (-not $rejected) { throw 'raw relative validator accepted literal backslash' }

Write-Host ('CanonicalPath PowerShell vectors passed: ' + $count)
