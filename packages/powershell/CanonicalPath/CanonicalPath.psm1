Set-StrictMode -Version 2.0

if ($null -eq ('CanonicalPath.PowerShell.DaemonClient' -as [type])) {
    Add-Type -Path (Join-Path $PSScriptRoot 'DaemonClient.cs') -IgnoreWarnings -WarningAction SilentlyContinue
}

class CanonicalPathException : System.Exception {
    [string] $Code

    CanonicalPathException([string] $code, [string] $message) : base($message) {
        $this.Code = $code
    }
}

class CanonicalFSDaemonException : System.Exception {
    [string] $Code
    [int] $StatusCode

    CanonicalFSDaemonException([string] $code, [string] $message, [int] $statusCode) : base($message) {
        $this.Code = $code
        $this.StatusCode = $statusCode
    }
}

function New-CanonicalPathError {
    param(
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Message
    )
    return [CanonicalPathException]::new($Code, $Message)
}

function New-CanonicalFSDaemonError {
    param(
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Message,
        [int] $StatusCode = 0
    )
    return [CanonicalFSDaemonException]::new($Code, $Message, $StatusCode)
}

function Get-CanonicalErrorCode {
    param([Parameter(Mandatory = $true)] $ErrorObject)

    $exception = $ErrorObject
    if ($ErrorObject -is [System.Management.Automation.ErrorRecord]) {
        $exception = $ErrorObject.Exception
    }
    while ($exception) {
        if ($exception.PSObject.Properties.Match('Code').Count -gt 0) {
            return [string] $exception.Code
        }
        $exception = $exception.InnerException
    }
    return 'ERR_INVALID_PATH'
}

function Get-OptionValue {
    param(
        $Options,
        [Parameter(Mandatory = $true)][string] $Name,
        $Default = $null
    )

    if ($null -eq $Options) { return $Default }
    if ($Options -is [hashtable] -and $Options.ContainsKey($Name)) { return $Options[$Name] }
    $property = $Options.PSObject.Properties[$Name]
    if ($null -ne $property) { return $property.Value }
    return $Default
}

function Test-AsciiLetter {
    param([string] $Value)
    return $Value -cmatch '^[A-Za-z]$'
}

function Test-UriScheme {
    param([string] $Value)
    return $Value -cmatch '^[A-Za-z][A-Za-z0-9+.-]*://'
}

function Test-DriveRoot {
    param([string] $Value)
    return $Value -cmatch '^[A-Za-z]:/'
}

function Test-DriveRelative {
    param([string] $Value)
    return $Value -cmatch '^[A-Za-z]:($|[^/])'
}

function Test-UriWindowsDrivePath {
    param([string] $Value)
    return $Value -cmatch '^/[A-Za-z]:/'
}

function Test-AbsolutePathLike {
    param([string] $Value)
    return $Value.StartsWith('/', [StringComparison]::Ordinal) -or $Value.StartsWith('\\', [StringComparison]::Ordinal) -or (($Value -replace '\\', '/') -cmatch '^[A-Za-z]:/')
}

function Remove-WindowsExtendedPrefix {
    param([string] $Value)

    if ($Value.StartsWith('\\?\UNC\', [StringComparison]::Ordinal)) { return '\\' + $Value.Substring(8) }
    if ($Value.StartsWith('\\?\', [StringComparison]::Ordinal)) { return $Value.Substring(4) }
    return $Value
}

function ConvertFrom-WSLDrivePath {
    param(
        [string] $Value,
        $Options
    )

    if (-not [bool] (Get-OptionValue $Options 'enabled' $false)) { return $null }
    $mountRoot = [string] (Get-OptionValue $Options 'mountRoot' '/mnt')
    $mountRoot = $mountRoot -replace '/+$', ''
    $prefix = ($mountRoot -replace '/+', '/') + '/'
    if (-not $Value.StartsWith($prefix, [StringComparison]::Ordinal)) { return $null }

    $rest = $Value.Substring($prefix.Length)
    if ($rest.Length -lt 1 -or -not (Test-AsciiLetter $rest.Substring(0, 1))) { return $null }
    if ($rest.Length -gt 1 -and $rest.Substring(1, 1) -ne '/') { return $null }

    $drive = $rest.Substring(0, 1).ToLowerInvariant()
    if ($rest.Length -eq 1) { return $drive + ':/' }
    return $drive + ':/' + $rest.Substring(2)
}

function Split-CanonicalRoot {
    param([Parameter(Mandatory = $true)][string] $Value)

    if (Test-DriveRoot $Value) {
        return @{ Prefix = $Value.Substring(0, 3); Rest = $Value.Substring(3) }
    }
    if ($Value.StartsWith('//', [StringComparison]::Ordinal)) {
        $parts = $Value.Substring(2).Split('/')
        if ($parts.Length -lt 2 -or $parts[0].Length -eq 0 -or $parts[1].Length -eq 0) {
            throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'UNC path requires server and share')
        }
        $prefix = '//' + $parts[0] + '/' + $parts[1]
        $restParts = @()
        if ($parts.Length -gt 2) { $restParts = $parts[2..($parts.Length - 1)] }
        return @{ Prefix = $prefix; Rest = [string]::Join('/', $restParts) }
    }
    if ($Value.StartsWith('/', [StringComparison]::Ordinal)) {
        return @{ Prefix = '/'; Rest = $Value.Substring(1) }
    }
    return @{ Prefix = ''; Rest = $Value }
}

function ConvertTo-CleanCanonicalPath {
    param([Parameter(Mandatory = $true)][string] $Value)

    if ($Value.Length -eq 0) { throw (New-CanonicalPathError 'ERR_EMPTY_PATH' 'path is empty') }
    $split = Split-CanonicalRoot $Value
    $prefix = [string] $split.Prefix
    $parts = New-Object System.Collections.ArrayList

    foreach ($part in ([string] $split.Rest).Split('/')) {
        if ($part.Length -eq 0 -or $part.Equals('.', [StringComparison]::Ordinal)) { continue }
        if ($part.Equals('..', [StringComparison]::Ordinal)) {
            if ($parts.Count -gt 0) {
                [void] $parts.RemoveAt($parts.Count - 1)
                continue
            }
            if ($prefix.Length -ne 0) { continue }
            throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'relative path escapes above its root')
        }
        [void] $parts.Add($part)
    }

    $joined = [string]::Join('/', [string[]] $parts.ToArray([string]))
    if ($prefix.Length -eq 0) {
        if ($joined.Length -eq 0) { return '.' }
        return $joined
    }
    if ($prefix.Equals('/', [StringComparison]::Ordinal)) {
        if ($joined.Length -eq 0) { return '/' }
        return '/' + $joined
    }
    if ($prefix.EndsWith('/', [StringComparison]::Ordinal)) {
        if ($joined.Length -eq 0) { return $prefix }
        return $prefix + $joined
    }
    if ($joined.Length -eq 0) { return $prefix }
    return $prefix + '/' + $joined
}

function Test-WindowsADS {
    param([string] $Value)

    $start = 0
    if (Test-DriveRoot $Value) {
        $start = 3
    } elseif ($Value.StartsWith('//', [StringComparison]::Ordinal)) {
        $parts = $Value.Substring(2).Split('/')
        if ($parts.Length -ge 2) { $start = ('//' + $parts[0] + '/' + $parts[1]).Length }
    }
    return $Value.Substring($start).Contains(':')
}

function Test-ReservedDeviceBase {
    param([string] $Base)
    $upper = $Base.ToUpperInvariant()
    if (@('CON', 'PRN', 'AUX', 'NUL') -contains $upper) { return $true }
    return $upper -match '^(COM|LPT)[1-9]$'
}

function Test-ReservedDeviceName {
    param([string] $Value)

    try { $rest = [string] (Split-CanonicalRoot $Value).Rest } catch { return $false }
    foreach ($part in $rest.Split('/')) {
        if ($part.Length -eq 0 -or $part.Equals('.', [StringComparison]::Ordinal) -or $part.Equals('..', [StringComparison]::Ordinal)) { continue }
        $base = ($part -split '[.:]', 2)[0]
        if (Test-ReservedDeviceBase $base) { return $true }
    }
    return $false
}

function Test-EncodedSeparator {
    param([string] $Value)
    return $Value -match '%(2f|2F|5c|5C)'
}

function Test-InvalidPercentEncoding {
    param([string] $Value)
    return $Value -match '%($|[^0-9A-Fa-f]|.[^0-9A-Fa-f])'
}

function ConvertFrom-UriText {
    param([string] $Value)
    $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
    $inputBytes = $utf8.GetBytes($Value)
    $output = New-Object 'System.Collections.Generic.List[byte]'
    for ($i = 0; $i -lt $inputBytes.Length; $i++) {
        if ($inputBytes[$i] -ne 37) { $output.Add($inputBytes[$i]); continue }
        $pair = [Text.Encoding]::ASCII.GetString($inputBytes, $i + 1, 2)
        $output.Add([Convert]::ToByte($pair, 16))
        $i += 2
    }
    return $utf8.GetString($output.ToArray())
}

function ConvertFrom-FileUriPath {
    param(
        [Parameter(Mandatory = $true)][string] $Uri,
        [Parameter(Mandatory = $true)][string] $Prefix,
        $Options
    )

    $uriOptions = Get-OptionValue $Options 'uri' $null
    $rejectEncodedSlash = Get-OptionValue $uriOptions 'rejectEncodedSlash' $true
    if ([bool] $rejectEncodedSlash -and (Test-EncodedSeparator $Uri)) {
        throw (New-CanonicalPathError 'ERR_ENCODED_SEPARATOR' 'URI contains an encoded path separator')
    }
    if (Test-InvalidPercentEncoding $Uri) {
        throw (New-CanonicalPathError 'ERR_INVALID_PERCENT_ENCODING' 'URI percent encoding is invalid')
    }

    $rest = $Uri.Substring($Prefix.Length)
    $slash = $rest.IndexOf('/', [StringComparison]::Ordinal)
    if ($slash -lt 0) { throw (New-CanonicalPathError 'ERR_INVALID_URI' 'URI path is empty') }

    $authority = $rest.Substring(0, $slash)
    $pathPart = $rest.Substring($slash)
    try {
        $decoded = ConvertFrom-UriText $pathPart
        $decodedAuthority = ConvertFrom-UriText $authority
    } catch {
        throw (New-CanonicalPathError 'ERR_INVALID_PERCENT_ENCODING' 'URI percent encoding is invalid')
    }
    if ($decoded.IndexOf([char]0) -ge 0 -or $decodedAuthority.IndexOf([char]0) -ge 0) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'decoded URI contains NUL') }
    if ($decoded.Length -eq 0) { throw (New-CanonicalPathError 'ERR_INVALID_URI' 'URI path is empty') }
    if ($Prefix -eq 'file://' -and $decodedAuthority.Length -ne 0 -and -not $decodedAuthority.Equals('localhost', [StringComparison]::OrdinalIgnoreCase)) {
        return '//' + $decodedAuthority + $decoded
    }
    return $decoded
}

function ConvertFrom-CanonicalFileUri {
    param(
        [Parameter(Mandatory = $true)][string] $Value,
        $Options
    )

    $uriOptions = Get-OptionValue $Options 'uri' $null
    if ($Value.StartsWith('file://', [StringComparison]::Ordinal)) {
        if (-not [bool] (Get-OptionValue $uriOptions 'allowFileUri' $false)) {
            throw (New-CanonicalPathError 'ERR_UNSUPPORTED_URI_SCHEME' 'file URI is not allowed')
        }
        return ConvertFrom-FileUriPath $Value 'file://' $Options
    }
    if ($Value.StartsWith('vscode-file://', [StringComparison]::Ordinal)) {
        if (-not [bool] (Get-OptionValue $uriOptions 'allowVSCodeFileUri' $false)) {
            throw (New-CanonicalPathError 'ERR_UNSUPPORTED_URI_SCHEME' 'vscode-file URI is not allowed')
        }
        return ConvertFrom-FileUriPath $Value 'vscode-file://' $Options
    }
    if (Test-UriScheme $Value) { throw (New-CanonicalPathError 'ERR_UNSUPPORTED_URI_SCHEME' 'unsupported URI scheme') }
    return $Value
}

function Assert-TargetProfile {
    param([string] $Value, [string] $TargetProfile)
    $parsed = Split-CanonicalGrammar $Value
    if ($TargetProfile.Length -eq 0 -or $TargetProfile.Equals('portable', [StringComparison]::Ordinal)) { return }
    if ($TargetProfile.Equals('posix', [StringComparison]::Ordinal) -and -not $parsed.Windows) { return }
    if ($TargetProfile.Equals('win32-drive', [StringComparison]::Ordinal) -and $parsed.Kind -in @('relative', 'drive', 'extended-drive')) { return }
    throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'canonical root is incompatible with target profile')
}


function New-CanonicalGrammarRoot {
    param([string] $Prefix, [string] $Rest)
    $kind = if ($Prefix.Length -eq 0) { 'relative' } elseif ($Prefix.Equals('/', [StringComparison]::Ordinal)) { 'posix' } elseif ($Prefix.StartsWith('//?/UNC/', [StringComparison]::Ordinal)) { 'extended-unc' } elseif ($Prefix.StartsWith('//?/', [StringComparison]::Ordinal)) { 'extended-drive' } elseif ($Prefix.StartsWith('//', [StringComparison]::Ordinal)) { 'unc' } else { 'drive' }
    return @{ Prefix = $Prefix; Rest = $Rest; Kind = $kind; Windows = ($kind -ne 'relative' -and $kind -ne 'posix') }
}

function Split-CanonicalGrammarUNC {
    param([string] $Value, [string] $Prefix)
    $parts = $Value.Split('/')
    if ($parts.Length -lt 2 -or $parts[0].Length -eq 0 -or $parts[1].Length -eq 0 -or $parts[0].Equals('.', [StringComparison]::Ordinal) -or $parts[0].Equals('..', [StringComparison]::Ordinal) -or $parts[1].Equals('.', [StringComparison]::Ordinal) -or $parts[1].Equals('..', [StringComparison]::Ordinal)) {
        throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'UNC requires server and share')
    }
    return New-CanonicalGrammarRoot ($Prefix + $parts[0] + '/' + $parts[1]) ([string]::Join('/', $parts, 2, $parts.Length - 2))
}

function Split-CanonicalGrammar {
    param([AllowEmptyString()][string] $Value, [bool] $NativePosix = $false)
    if ($Value.Length -eq 0) { throw (New-CanonicalPathError 'ERR_EMPTY_PATH' 'path is empty') }
    if ($Value.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'path contains NUL') }
    if ($NativePosix) {
        if ($Value.StartsWith('//', [StringComparison]::Ordinal) -and -not $Value.StartsWith('///', [StringComparison]::Ordinal)) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'double-leading-slash POSIX path is unsupported') }
        if ($Value.StartsWith('/', [StringComparison]::Ordinal)) { return New-CanonicalGrammarRoot '/' $Value.Substring(1) }
        return New-CanonicalGrammarRoot '' $Value
    }
    if ($Value.StartsWith('//?/', [StringComparison]::Ordinal)) {
        $tail = $Value.Substring(4)
        if (Test-DriveRoot $tail) { $parsed = New-CanonicalGrammarRoot ('//?/' + $tail.Substring(0, 1).ToLowerInvariant() + ':/') $tail.Substring(3) }
        elseif ($tail.StartsWith('UNC/', [StringComparison]::Ordinal)) { $parsed = Split-CanonicalGrammarUNC $tail.Substring(4) '//?/UNC/' }
        else { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'unsupported or incomplete extended root') }
    } elseif (Test-DriveRoot $Value) { $parsed = New-CanonicalGrammarRoot ($Value.Substring(0, 1).ToLowerInvariant() + ':/') $Value.Substring(3) }
    elseif (Test-DriveRelative $Value) { throw (New-CanonicalPathError 'ERR_DRIVE_RELATIVE_PATH' 'unmarked drive-relative path') }
    elseif ($Value.StartsWith('//', [StringComparison]::Ordinal)) { $parsed = Split-CanonicalGrammarUNC $Value.Substring(2) '//' }
    elseif ($Value.StartsWith('/', [StringComparison]::Ordinal)) { $parsed = New-CanonicalGrammarRoot '/' $Value.Substring(1) }
    else { $parsed = New-CanonicalGrammarRoot '' $Value }
    if ($parsed.Windows -and $Value.Contains('\')) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'Windows canonical components cannot contain backslash') }
    return $parsed
}

function Add-CanonicalRelativeMarker {
    param([string] $Value)
    if ($Value.Length -ge 2 -and (Test-AsciiLetter $Value.Substring(0, 1)) -and $Value[1] -eq ':') { return './' + $Value }
    return $Value
}

function ConvertTo-CleanCanonicalGrammar {
    param([AllowEmptyString()][string] $Value, [bool] $NativePosix = $false, [string] $EscapeCode = 'ERR_INVALID_PATH')
    $parsed = Split-CanonicalGrammar $Value $NativePosix
    $parts = New-Object System.Collections.ArrayList
    foreach ($part in $parsed.Rest.Split('/')) {
        if ($part.Length -eq 0 -or $part.Equals('.', [StringComparison]::Ordinal)) { continue }
        if ($part.Equals('..', [StringComparison]::Ordinal)) {
            if ($parts.Count -gt 0) { $parts.RemoveAt($parts.Count - 1) }
            elseif ($parsed.Prefix.Length -eq 0) { throw (New-CanonicalPathError $EscapeCode 'relative path escapes its root') }
        } else { [void] $parts.Add($part) }
    }
    $joined = [string]::Join('/', [string[]] $parts.ToArray([string]))
    if ($parsed.Prefix.Length -eq 0) {
        if ($joined.Length -eq 0) { return '.' }
        return Add-CanonicalRelativeMarker $joined
    }
    $separator = if ($joined.Length -eq 0 -or $parsed.Prefix.EndsWith('/', [StringComparison]::Ordinal)) { '' } else { '/' }
    return $parsed.Prefix + $separator + $joined
}

function Assert-CanonicalGrammar {
    param([AllowEmptyString()][string] $Value, [bool] $AllowDriveCase = $false)
    $parsed = Split-CanonicalGrammar $Value
    $comparisonValue = $Value
    if ($AllowDriveCase -and $parsed.Kind -eq 'drive') { $comparisonValue = $Value.Substring(0, 1).ToLowerInvariant() + $Value.Substring(1) }
    elseif ($AllowDriveCase -and $parsed.Kind -eq 'extended-drive') { $comparisonValue = $Value.Substring(0, 4) + $Value.Substring(4, 1).ToLowerInvariant() + $Value.Substring(5) }
    if (-not [string]::Equals((ConvertTo-CleanCanonicalGrammar $Value), $comparisonValue, [StringComparison]::Ordinal)) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'path must be lexically cleaned canonical data') }
    return $parsed
}

function Get-NormalizedWSLMount {
    param([AllowEmptyString()][string] $Value)
    if ($Value.Length -eq 0) { $Value = '/mnt' }
    $parsed = Split-CanonicalGrammar $Value $true
    if ($parsed.Kind -ne 'posix') { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'WSL mount root must be absolute POSIX') }
    return ConvertTo-CleanCanonicalGrammar $Value $true
}

function Assert-WindowsGrammarComponents {
    param([string] $Value, $Options, [bool] $NativePosix = $false)
    $parsed = Split-CanonicalGrammar $Value $NativePosix
    $windows = Get-OptionValue $Options 'windows' $null
    if ([bool] (Get-OptionValue $windows 'rejectADS' $false) -and $parsed.Rest.Contains(':')) { throw (New-CanonicalPathError 'ERR_ALTERNATE_DATA_STREAM' 'Windows alternate data stream is not allowed') }
    if ([bool] (Get-OptionValue $windows 'rejectDeviceNames' $false)) {
        foreach ($part in $parsed.Rest.Split('/')) {
            $base = $part.Split('.')[0].Split(':')[0]
            if (Test-ReservedDeviceBase $base) { throw (New-CanonicalPathError 'ERR_RESERVED_DEVICE_NAME' 'Windows reserved device name is not allowed') }
        }
    }
}

function ConvertTo-CanonicalPath {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true, Position = 0)][AllowEmptyString()][string] $Path, [Parameter(Position = 1)] $Options = @{})
    $value = $Path
    if ([bool] (Get-OptionValue $Options 'trimOuterWhitespace' $false)) { $value = $value.Trim() }
    if ($value.Length -eq 0) { throw (New-CanonicalPathError 'ERR_EMPTY_PATH' 'path is empty') }
    if ($value.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'path contains NUL') }
    $wsl = Get-OptionValue $Options 'wsl' $null
    $mount = Get-NormalizedWSLMount ([string] (Get-OptionValue $wsl 'mountRoot' ''))
    $sourceGrammar = [string] (Get-OptionValue $Options 'sourceHost' '')
    $targetProfile = [string] (Get-OptionValue $Options 'targetProfile' '')
    if ($sourceGrammar.Equals('posix', [StringComparison]::Ordinal)) {
        if ([bool] (Get-OptionValue $wsl 'enabled' $false)) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'native POSIX input cannot enable WSL mapping') }
        Assert-WindowsGrammarComponents $value $Options $true
        $value = ConvertTo-CleanCanonicalGrammar $value $true
    } elseif ($sourceGrammar.Equals('canonical', [StringComparison]::Ordinal)) {
        Assert-WindowsGrammarComponents $value $Options
        $value = ConvertTo-CleanCanonicalGrammar $value
    } else {
        $uriInput = Test-UriScheme $value
        if ($uriInput -or $sourceGrammar.Equals('vscode-file-uri', [StringComparison]::Ordinal)) { $value = ConvertFrom-CanonicalFileUri $value $Options }
        $candidate = [bool] (Get-OptionValue $wsl 'enabled' $false) -and $value.StartsWith('/', [StringComparison]::Ordinal) -and (-not $value.StartsWith('//', [StringComparison]::Ordinal) -or $value.StartsWith('///', [StringComparison]::Ordinal)) -and -not ($uriInput -and (Test-UriWindowsDrivePath $value))
        if ($candidate) {
            Assert-WindowsGrammarComponents $value $Options $true
            $value = ConvertTo-CleanCanonicalGrammar $value $true
            $prefix = if ($mount.Equals('/', [StringComparison]::Ordinal)) { '/' } else { $mount + '/' }
            if (-not $targetProfile.Equals('posix', [StringComparison]::Ordinal) -and $value.StartsWith($prefix, [StringComparison]::Ordinal)) {
                $tail = $value.Substring($prefix.Length)
                if ($tail.Length -gt 0 -and (Test-AsciiLetter $tail.Substring(0, 1)) -and ($tail.Length -eq 1 -or $tail[1] -eq '/')) {
                    $rest = if ($tail.Length -eq 1) { '' } else { $tail.Substring(2) }
                    $value = $tail.Substring(0, 1).ToLowerInvariant() + ':/' + $rest
                }
            }
            $value = ConvertTo-CleanCanonicalGrammar $value
        } else {
            $value = $value.Replace('\', '/')
            if (Test-UriWindowsDrivePath $value) { $value = $value.Substring(1) }
            $parsed = Split-CanonicalGrammar $value
            $windows = Get-OptionValue $Options 'windows' $null
            if (-not [bool] (Get-OptionValue $windows 'preserveExtendedLength' $false)) {
                if ($parsed.Kind -eq 'extended-drive') { $value = $value.Substring(4) }
                elseif ($parsed.Kind -eq 'extended-unc') { $value = '//' + $value.Substring(8) }
            }
            Assert-WindowsGrammarComponents $value $Options
            $value = ConvertTo-CleanCanonicalGrammar $value
        }
    }
    Assert-TargetProfile $value $targetProfile
    return $value
}

function Get-CanonicalParts {
    param([Parameter(Mandatory = $true)][string] $Path)

    if ($Path.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'path contains NUL') }
    $split = Split-CanonicalRoot $Path
    if (([string] $split.Prefix).Length -eq 0) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'path must be canonical absolute') }

    $parts = @()
    if (([string] $split.Rest).Length -ne 0) { $parts = ([string] $split.Rest).Split('/') | Where-Object { $_.Length -ne 0 } }
    foreach ($part in $parts) {
        if ($part.Equals('.', [StringComparison]::Ordinal) -or $part.Equals('..', [StringComparison]::Ordinal)) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'path is not lexically cleaned') }
    }
    return @{ Prefix = [string] $split.Prefix; Parts = @($parts) }
}

function Get-CanonicalRelativePath {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Root, [Parameter(Mandatory = $true)][string] $Target)
    $left = Assert-CanonicalGrammar $Root
    $right = Assert-CanonicalGrammar $Target
    if ($left.Prefix.Length -eq 0 -or $right.Prefix.Length -eq 0) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'relative operands must be absolute canonical paths') }
    $leftParts = @($left.Rest.Split('/') | Where-Object { $_.Length -gt 0 })
    $rightParts = @($right.Rest.Split('/') | Where-Object { $_.Length -gt 0 })
    if (-not $left.Prefix.Equals($right.Prefix, [StringComparison]::Ordinal) -or $rightParts.Count -lt $leftParts.Count) { throw (New-CanonicalPathError 'ERR_OUTSIDE_ROOT' 'target is outside root') }
    for ($i = 0; $i -lt $leftParts.Count; $i++) { if (-not $leftParts[$i].Equals($rightParts[$i], [StringComparison]::Ordinal)) { throw (New-CanonicalPathError 'ERR_OUTSIDE_ROOT' 'target is outside root') } }
    if ($leftParts.Count -eq $rightParts.Count) { return '.' }
    return Add-CanonicalRelativeMarker ([string]::Join('/', [string[]] $rightParts[$leftParts.Count..($rightParts.Count - 1)]))
}

function ConvertTo-CanonicalRelativePath {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string] $Path)

    if ($Path.Length -eq 0) { throw (New-CanonicalPathError 'ERR_EMPTY_PATH' 'relative path is empty') }
    if ($Path.Equals('.', [StringComparison]::Ordinal)) { return '.' }
    if ($Path.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'relative path contains NUL') }
    if (Test-AbsolutePathLike $Path) { throw (New-CanonicalPathError 'ERR_ABSOLUTE_PATH' 'relative path must not be absolute') }
    if (Test-DriveRelative $Path) { throw (New-CanonicalPathError 'ERR_DRIVE_RELATIVE_PATH' 'drive-relative path is not allowed') }
    if ($Path.Contains('\')) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'relative path must use slash separators') }

    $parts = New-Object System.Collections.ArrayList
    foreach ($part in $Path.Split('/')) {
        if ($part.Length -eq 0 -or $part.Equals('.', [StringComparison]::Ordinal)) { continue }
        if ($part.Equals('..', [StringComparison]::Ordinal)) {
            if ($parts.Count -eq 0) { throw (New-CanonicalPathError 'ERR_OUTSIDE_ROOT' 'relative path escapes root') }
            [void] $parts.RemoveAt($parts.Count - 1)
            continue
        }
        [void] $parts.Add($part)
    }
    if ($parts.Count -eq 0) { throw (New-CanonicalPathError 'ERR_EMPTY_PATH' 'relative path is empty after cleaning') }
    return [string]::Join('/', [string[]] $parts.ToArray([string]))
}

function Join-CanonicalPath {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Root, [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Relative)
    $parsedRoot = Assert-CanonicalGrammar $Root
    $parsedRelative = Split-CanonicalGrammar $Relative
    if ($parsedRelative.Prefix.Length -ne 0) { throw (New-CanonicalPathError 'ERR_ABSOLUTE_PATH' 'join argument must be relative') }
    if ($parsedRoot.Windows -and $Relative.Contains('\')) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'backslash data is not representable under a Windows root') }
    $clean = ConvertTo-CleanCanonicalGrammar $Relative $false 'ERR_OUTSIDE_ROOT'
    if ($clean.Equals('.', [StringComparison]::Ordinal)) { return $Root }
    if ($clean.StartsWith('./', [StringComparison]::Ordinal)) { $clean = $clean.Substring(2) }
    $combined = if ($Root.Equals('.', [StringComparison]::Ordinal)) { $clean } else { $Root.TrimEnd('/') + '/' + $clean }
    return ConvertTo-CleanCanonicalGrammar $combined ($parsedRoot.Kind -eq 'relative')
}

function Test-CanonicalPathEqual {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Left,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Right,
        [Parameter(Position = 2)] $Options = @{}
    )

    return [string]::Equals((ConvertTo-CanonicalPath $Left $Options), (ConvertTo-CanonicalPath $Right $Options), [System.StringComparison]::Ordinal)
}

function ConvertTo-CanonicalWin32Path {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Path)
    $parsed = Assert-CanonicalGrammar $Path $true
    if ($parsed.Kind -eq 'posix' -or $Path.Contains('\') -or $Path.StartsWith('./', [StringComparison]::Ordinal)) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'canonical path is not representable as Windows') }
    $value = $Path
    if ($parsed.Kind -eq 'drive') { $value = $value.Substring(0, 1).ToUpperInvariant() + $value.Substring(1) }
    if ($parsed.Kind -eq 'extended-drive') { $value = $value.Substring(0, 4) + $value.Substring(4, 1).ToUpperInvariant() + $value.Substring(5) }
    return $value.Replace('/', '\')
}

function ConvertTo-CanonicalWSLPath {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Path, $Options = @{})
    $mount = Get-NormalizedWSLMount ([string] (Get-OptionValue $Options 'mountRoot' ''))
    $parsed = Assert-CanonicalGrammar $Path $true
    if ($parsed.Kind -in @('posix', 'relative')) { return $Path }
    if ($parsed.Kind -ne 'drive') { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'WSL serialization requires an ordinary drive') }
    $prefix = if ($mount.Equals('/', [StringComparison]::Ordinal)) { '' } else { $mount }
    $tail = if ($parsed.Rest.Length -eq 0) { '' } else { '/' + $parsed.Rest }
    return $prefix + '/' + $parsed.Prefix.Substring(0, 1) + $tail
}

function ConvertTo-CanonicalPosixPath {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Path)
    if ((Assert-CanonicalGrammar $Path).Windows) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'Windows root requires explicit host mapping') }
    return $Path
}

function Escape-ReservedWin32Component {
    param([string] $Value)

    $dot = $Value.IndexOf('.', [StringComparison]::Ordinal)
    if ($dot -ge 0) {
        $base = $Value.Substring(0, $dot)
        $suffix = $Value.Substring($dot)
    } else {
        $base = $Value
        $suffix = ''
    }
    if (Test-ReservedDeviceBase $base) { return $base + '-' + $suffix }
    return $Value
}

function ConvertTo-CanonicalComponent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Name,
        [Parameter(Mandatory = $true)][ValidateSet('portable', 'win32', 'posix')][string] $Profile
    )

    if ($Name.Length -eq 0) { throw (New-CanonicalPathError 'ERR_INVALID_COMPONENT' 'component is empty') }
    if ($Name.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'component contains NUL') }
    $value = $Name -replace '[\\/:\t\n\r]+', '-'
    $value = $value -replace '^[ ._-]+|[ ._-]+$', ''
    if ($value.Length -eq 0) { $value = 'component' }
    if ($Profile -eq 'win32') { $value = Escape-ReservedWin32Component $value }
    return $value
}

function New-CanonicalFSDaemonClient {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Endpoint,
        [string] $Token = '',
        [ValidateRange(1, 30000)][int] $TimeoutMilliseconds = 30000,
        [ValidateRange(1, 25165824)][int] $MaxResponseBytes = 25165824,
        [string] $CertificateSha256 = $env:CANONICALFS_TLS_CERTIFICATE_SHA256,
        [string] $CACertificatePath = $env:CANONICALFS_TLS_CA_FILE
    )

    $caPem = $null
    if (-not [string]::IsNullOrEmpty($CACertificatePath)) {
        $caInfo = Get-Item -LiteralPath $CACertificatePath
        if ($caInfo.PSIsContainer -or $caInfo.Length -gt 65536) { throw (New-CanonicalFSDaemonError 'ERR_DAEMON_CLIENT' 'invalid trusted CA file') }
        $caPem = [IO.File]::ReadAllText($caInfo.FullName)
    }
    return [CanonicalPath.PowerShell.DaemonClient]::new($Endpoint, $Token, $TimeoutMilliseconds, $MaxResponseBytes, $caPem, $CertificateSha256)
}

function Invoke-CanonicalFSDaemonRequest {
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $Method,
        [Parameter(Mandatory = $true)][string] $Path,
        $Body = $null,
        [switch] $NoAuth
    )

    if ($Client -isnot [CanonicalPath.PowerShell.DaemonClient]) {
        throw (New-CanonicalFSDaemonError 'ERR_DAEMON_CLIENT' 'client must be created by New-CanonicalFSDaemonClient')
    }
    $json = $null
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Depth 8 -Compress
    }

    try {
        $transport = $Client.Send($Method, $Path, $json, [bool] $NoAuth)
    } catch {
        $code = Get-CanonicalErrorCode $_
        if ($code -notin @('ERR_DAEMON_CLIENT', 'ERR_RESPONSE_TOO_LARGE')) { $code = 'ERR_DAEMON' }
        throw (New-CanonicalFSDaemonError $code 'daemon transport request failed or timed out' 0)
    }
    try { $response = $transport.Json | ConvertFrom-Json }
    catch { throw (New-CanonicalFSDaemonError 'ERR_DAEMON' 'daemon response is not valid JSON' $transport.StatusCode) }
    if ($null -ne $response -and $null -ne $response.PSObject.Properties['error'] -and $null -ne $response.error) {
        throw (New-CanonicalFSDaemonError ([string] $response.error.code) ([string] $response.error.message) $transport.StatusCode)
    }
    if ($transport.StatusCode -ge 300) { throw (New-CanonicalFSDaemonError 'ERR_DAEMON' 'daemon returned a non-success HTTP status' $transport.StatusCode) }
    return $response
}

function Get-CanonicalFSDaemonHealth {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] $Client)

    return Invoke-CanonicalFSDaemonRequest -Client $Client -Method 'Get' -Path '/healthz' -NoAuth
}

function Get-CanonicalFSDaemonCapabilities {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] $Client)

    return Invoke-CanonicalFSDaemonRequest -Client $Client -Method 'Get' -Path '/v1/caps'
}

function Open-CanonicalFSProject {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string] $HostRoot
    )

    return Invoke-CanonicalFSDaemonRequest -Client $Client -Method 'Post' -Path '/v1/projects/open' -Body @{ project_id = $ProjectId; host_root = $HostRoot }
}

function Close-CanonicalFSProject {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $ProjectId
    )

    return Invoke-CanonicalFSDaemonRequest -Client $Client -Method 'Post' -Path '/v1/projects/close' -Body @{ project_id = $ProjectId }
}

function Read-CanonicalFSFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string] $Path,
        [int64] $MaxBytes = 0
    )

    $body = @{ project_id = $ProjectId; path = $Path }
    if ($MaxBytes -gt 0) { $body['max_bytes'] = $MaxBytes }
    $response = Invoke-CanonicalFSDaemonRequest -Client $Client -Method 'Post' -Path '/v1/fs/readFile' -Body $body
    return ,([Convert]::FromBase64String([string] $response.data_base64))
}

function Read-CanonicalFSText {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string] $Path,
        [int64] $MaxBytes = 0
    )

    $bytes = Read-CanonicalFSFile -Client $Client -ProjectId $ProjectId -Path $Path -MaxBytes $MaxBytes
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Write-CanonicalFSFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][byte[]] $Bytes
    )

    return Invoke-CanonicalFSDaemonRequest -Client $Client -Method 'Post' -Path '/v1/fs/writeFile' -Body @{
        project_id = $ProjectId
        path = $Path
        data_base64 = [Convert]::ToBase64String($Bytes)
    }
}

function Write-CanonicalFSText {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Text
    )

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    return Write-CanonicalFSFile -Client $Client -ProjectId $ProjectId -Path $Path -Bytes $bytes
}

function Get-CanonicalFSItem {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string] $Path
    )

    $response = Invoke-CanonicalFSDaemonRequest -Client $Client -Method 'Post' -Path '/v1/fs/stat' -Body @{ project_id = $ProjectId; path = $Path }
    return $response.stat
}

function New-CanonicalFSDirectory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string] $Path
    )

    return Invoke-CanonicalFSDaemonRequest -Client $Client -Method 'Post' -Path '/v1/fs/mkdirAll' -Body @{ project_id = $ProjectId; path = $Path }
}

function Remove-CanonicalFSItem {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string] $Path
    )

    return Invoke-CanonicalFSDaemonRequest -Client $Client -Method 'Post' -Path '/v1/fs/remove' -Body @{ project_id = $ProjectId; path = $Path }
}

function Rename-CanonicalFSItem {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $ProjectId,
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Target
    )

    return Invoke-CanonicalFSDaemonRequest -Client $Client -Method 'Post' -Path '/v1/fs/rename' -Body @{ project_id = $ProjectId; path = $Path; target = $Target }
}

function ConvertTo-CanonicalGitRef {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string] $Ref)

    if ($Ref.Length -eq 0) { throw (New-CanonicalPathError 'ERR_INVALID_COMPONENT' 'git ref is empty') }
    if ($Ref.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'git ref contains NUL') }
    try { $bytes = [System.Text.UTF8Encoding]::new($false, $true).GetBytes($Ref) }
    catch { throw (New-CanonicalPathError 'ERR_INVALID_COMPONENT' 'git ref contains invalid Unicode') }
    $slug = $Ref -creplace '[^A-Za-z0-9._-]+', '-'
    $slug = $slug -replace '^[._-]+|[._-]+$', ''
    if ($slug.Length -gt 80) { $slug = $slug.Substring(0, 80).Trim('.', '_', '-') }
    if ($slug -eq '') { $slug = 'ref' }

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha.ComputeHash($bytes)
    } finally {
        if ($sha -ne $null) { $sha.Dispose() }
    }
    $hex = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
    return 'v2-' + $slug + '--' + $hex
}

Export-ModuleMember -Function @(
    'ConvertTo-CanonicalPath',
    'Get-CanonicalRelativePath',
    'Join-CanonicalPath',
    'Test-CanonicalPathEqual',
    'ConvertTo-CanonicalWin32Path',
    'ConvertTo-CanonicalWSLPath',
    'ConvertTo-CanonicalPosixPath',
    'ConvertTo-CanonicalComponent',
    'ConvertTo-CanonicalGitRef',
    'New-CanonicalFSDaemonClient',
    'Get-CanonicalFSDaemonHealth',
    'Get-CanonicalFSDaemonCapabilities',
    'Open-CanonicalFSProject',
    'Close-CanonicalFSProject',
    'Read-CanonicalFSFile',
    'Read-CanonicalFSText',
    'Write-CanonicalFSFile',
    'Write-CanonicalFSText',
    'Get-CanonicalFSItem',
    'New-CanonicalFSDirectory',
    'Remove-CanonicalFSItem',
    'Rename-CanonicalFSItem'
)
