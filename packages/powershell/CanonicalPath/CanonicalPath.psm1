Set-StrictMode -Version 2.0

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
    return $Value -match '^[A-Za-z]$'
}

function Test-UriScheme {
    param([string] $Value)
    return $Value -match '^[A-Za-z][A-Za-z0-9+.-]*://'
}

function Test-DriveRoot {
    param([string] $Value)
    return $Value -match '^[A-Za-z]:/'
}

function Test-DriveRelative {
    param([string] $Value)
    return $Value -match '^[A-Za-z]:($|[^/])'
}

function Test-UriWindowsDrivePath {
    param([string] $Value)
    return $Value -match '^/[A-Za-z]:/'
}

function Test-AbsolutePathLike {
    param([string] $Value)
    return $Value.StartsWith('/') -or $Value.StartsWith('\\') -or (($Value -replace '\\', '/') -match '^[A-Za-z]:/')
}

function Remove-WindowsExtendedPrefix {
    param([string] $Value)

    if ($Value.StartsWith('\\?\UNC\')) { return '\\' + $Value.Substring(8) }
    if ($Value.StartsWith('\\?\')) { return $Value.Substring(4) }
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
    $prefix = $mountRoot + '/'
    if (-not $Value.StartsWith($prefix)) { return $null }

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
    if ($Value.StartsWith('//')) {
        $parts = $Value.Substring(2).Split('/')
        if ($parts.Length -lt 2 -or $parts[0] -eq '' -or $parts[1] -eq '') {
            throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'UNC path requires server and share')
        }
        $prefix = '//' + $parts[0] + '/' + $parts[1]
        $restParts = @()
        if ($parts.Length -gt 2) { $restParts = $parts[2..($parts.Length - 1)] }
        return @{ Prefix = $prefix; Rest = [string]::Join('/', $restParts) }
    }
    if ($Value.StartsWith('/')) {
        return @{ Prefix = '/'; Rest = $Value.Substring(1) }
    }
    return @{ Prefix = ''; Rest = $Value }
}

function ConvertTo-CleanCanonicalPath {
    param([Parameter(Mandatory = $true)][string] $Value)

    if ($Value -eq '') { throw (New-CanonicalPathError 'ERR_EMPTY_PATH' 'path is empty') }
    $split = Split-CanonicalRoot $Value
    $prefix = [string] $split.Prefix
    $parts = New-Object System.Collections.ArrayList

    foreach ($part in ([string] $split.Rest).Split('/')) {
        if ($part -eq '' -or $part -eq '.') { continue }
        if ($part -eq '..') {
            if ($parts.Count -gt 0) {
                [void] $parts.RemoveAt($parts.Count - 1)
                continue
            }
            if ($prefix -ne '') { continue }
            throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'relative path escapes above its root')
        }
        [void] $parts.Add($part)
    }

    $joined = [string]::Join('/', [string[]] $parts.ToArray([string]))
    if ($prefix -eq '') {
        if ($joined -eq '') { return '.' }
        return $joined
    }
    if ($prefix -eq '/') {
        if ($joined -eq '') { return '/' }
        return '/' + $joined
    }
    if ($prefix.EndsWith('/')) {
        if ($joined -eq '') { return $prefix }
        return $prefix + $joined
    }
    if ($joined -eq '') { return $prefix }
    return $prefix + '/' + $joined
}

function Test-WindowsADS {
    param([string] $Value)

    $start = 0
    if (Test-DriveRoot $Value) {
        $start = 3
    } elseif ($Value.StartsWith('//')) {
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
        if ($part -eq '' -or $part -eq '.' -or $part -eq '..') { continue }
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
    $slash = $rest.IndexOf('/')
    if ($slash -lt 0) { throw (New-CanonicalPathError 'ERR_INVALID_URI' 'URI path is empty') }

    $authority = $rest.Substring(0, $slash)
    $pathPart = $rest.Substring($slash)
    try {
        $decoded = [System.Uri]::UnescapeDataString($pathPart)
        $decodedAuthority = [System.Uri]::UnescapeDataString($authority)
    } catch {
        throw (New-CanonicalPathError 'ERR_INVALID_PERCENT_ENCODING' 'URI percent encoding is invalid')
    }
    if ($decoded -eq '') { throw (New-CanonicalPathError 'ERR_INVALID_URI' 'URI path is empty') }
    if ($Prefix -eq 'file://' -and $decodedAuthority -ne '' -and $decodedAuthority.ToLowerInvariant() -ne 'localhost') {
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
    if ($Value.StartsWith('file://')) {
        if (-not [bool] (Get-OptionValue $uriOptions 'allowFileUri' $false)) {
            throw (New-CanonicalPathError 'ERR_UNSUPPORTED_URI_SCHEME' 'file URI is not allowed')
        }
        return ConvertFrom-FileUriPath $Value 'file://' $Options
    }
    if ($Value.StartsWith('vscode-file://')) {
        if (-not [bool] (Get-OptionValue $uriOptions 'allowVSCodeFileUri' $false)) {
            throw (New-CanonicalPathError 'ERR_UNSUPPORTED_URI_SCHEME' 'vscode-file URI is not allowed')
        }
        return ConvertFrom-FileUriPath $Value 'vscode-file://' $Options
    }
    if (Test-UriScheme $Value) { throw (New-CanonicalPathError 'ERR_UNSUPPORTED_URI_SCHEME' 'unsupported URI scheme') }
    return $Value
}

function Assert-TargetProfile {
    param(
        [Parameter(Mandatory = $true)][string] $Value,
        [string] $TargetProfile
    )

    switch ($TargetProfile) {
        { $_ -eq $null -or $_ -eq '' -or $_ -eq 'portable' } { return }
        'posix' {
            if ((Test-DriveRoot $Value) -or $Value.StartsWith('//')) {
                throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'targetProfile posix does not allow Windows drive or UNC roots')
            }
            return
        }
        'win32-drive' {
            if ($Value.StartsWith('/')) {
                throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'targetProfile win32-drive does not allow POSIX or UNC roots')
            }
            return
        }
        default { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'unsupported targetProfile') }
    }
}

function ConvertTo-CanonicalPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true, Position = 0)][AllowEmptyString()][string] $Path,
        [Parameter(Position = 1)] $Options = @{}
    )

    $value = $Path
    if ([bool] (Get-OptionValue $Options 'trimOuterWhitespace' $false)) { $value = $value.Trim() }
    if ($value -eq '') { throw (New-CanonicalPathError 'ERR_EMPTY_PATH' 'path is empty') }
    if ($value.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'path contains NUL') }

    $sourceHost = [string] (Get-OptionValue $Options 'sourceHost' '')
    if ((Test-UriScheme $value) -or $sourceHost -eq 'vscode-file-uri') {
        $value = ConvertFrom-CanonicalFileUri $value $Options
    }

    $windowsOptions = Get-OptionValue $Options 'windows' $null
    if (-not [bool] (Get-OptionValue $windowsOptions 'preserveExtendedLength' $false)) {
        $value = Remove-WindowsExtendedPrefix $value
    }
    $value = $value -replace '\\', '/'

    $targetProfile = [string] (Get-OptionValue $Options 'targetProfile' '')
    if ($targetProfile -ne 'posix') {
        $mapped = ConvertFrom-WSLDrivePath $value (Get-OptionValue $Options 'wsl' $null)
        if ($null -ne $mapped) { $value = $mapped }
    }
    if (Test-UriWindowsDrivePath $value) { $value = $value.Substring(1) }

    if (Test-DriveRelative $value) {
        throw (New-CanonicalPathError 'ERR_DRIVE_RELATIVE_PATH' 'Windows drive-relative paths are not canonical')
    }
    if (Test-DriveRoot $value) {
        $value = $value.Substring(0, 1).ToLowerInvariant() + $value.Substring(1)
    }

    if ([bool] (Get-OptionValue $windowsOptions 'rejectADS' $false) -and (Test-WindowsADS $value)) {
        throw (New-CanonicalPathError 'ERR_ALTERNATE_DATA_STREAM' 'Windows alternate data stream is not allowed')
    }
    if ([bool] (Get-OptionValue $windowsOptions 'rejectDeviceNames' $false) -and (Test-ReservedDeviceName $value)) {
        throw (New-CanonicalPathError 'ERR_RESERVED_DEVICE_NAME' 'Windows reserved device name is not allowed')
    }

    $cleaned = ConvertTo-CleanCanonicalPath $value
    Assert-TargetProfile $cleaned $targetProfile
    return $cleaned
}

function Get-CanonicalParts {
    param([Parameter(Mandatory = $true)][string] $Path)

    if ($Path.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'path contains NUL') }
    $split = Split-CanonicalRoot $Path
    if ([string] $split.Prefix -eq '') { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'path must be canonical absolute') }

    $parts = @()
    if ([string] $split.Rest -ne '') { $parts = ([string] $split.Rest).Split('/') | Where-Object { $_ -ne '' } }
    foreach ($part in $parts) {
        if ($part -eq '.' -or $part -eq '..') { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'path is not lexically cleaned') }
    }
    return @{ Prefix = [string] $split.Prefix; Parts = @($parts) }
}

function Get-CanonicalRelativePath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string] $Target
    )

    $rootParts = Get-CanonicalParts $Root
    $targetParts = Get-CanonicalParts $Target
    if ($rootParts.Prefix -ne $targetParts.Prefix -or $targetParts.Parts.Count -lt $rootParts.Parts.Count) {
        throw (New-CanonicalPathError 'ERR_OUTSIDE_ROOT' 'target is outside root')
    }
    for ($index = 0; $index -lt $rootParts.Parts.Count; $index++) {
        if ($targetParts.Parts[$index] -ne $rootParts.Parts[$index]) {
            throw (New-CanonicalPathError 'ERR_OUTSIDE_ROOT' 'target is outside root')
        }
    }
    if ($targetParts.Parts.Count -eq $rootParts.Parts.Count) { return '.' }
    return [string]::Join('/', [string[]] $targetParts.Parts[$rootParts.Parts.Count..($targetParts.Parts.Count - 1)])
}

function ConvertTo-CanonicalRelativePath {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string] $Path)

    if ($Path -eq '') { throw (New-CanonicalPathError 'ERR_EMPTY_PATH' 'relative path is empty') }
    if ($Path -eq '.') { return '.' }
    if ($Path.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'relative path contains NUL') }
    if (Test-AbsolutePathLike $Path) { throw (New-CanonicalPathError 'ERR_ABSOLUTE_PATH' 'relative path must not be absolute') }
    if (Test-DriveRelative $Path) { throw (New-CanonicalPathError 'ERR_DRIVE_RELATIVE_PATH' 'drive-relative path is not allowed') }
    if ($Path.Contains('\')) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'relative path must use slash separators') }

    $parts = New-Object System.Collections.ArrayList
    foreach ($part in $Path.Split('/')) {
        if ($part -eq '' -or $part -eq '.') { continue }
        if ($part -eq '..') {
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
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Relative
    )

    $cleanRelative = ConvertTo-CanonicalRelativePath $Relative
    if ($Root.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'root contains NUL') }
    if ($cleanRelative -eq '.') { return $Root }
    if ($Root -eq '/' -or $Root.EndsWith('/')) { return $Root + $cleanRelative }
    return $Root + '/' + $cleanRelative
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

    if ($Path.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'path contains NUL') }
    if (Test-DriveRoot $Path) { return $Path.Substring(0, 1).ToUpperInvariant() + ':\' + ($Path.Substring(3) -replace '/', '\') }
    if ($Path.StartsWith('//')) { return '\\' + ($Path.Substring(2) -replace '/', '\') }
    return $Path -replace '/', '\'
}

function ConvertTo-CanonicalWSLPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        $Options = @{}
    )

    if ($Path.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'path contains NUL') }
    if (-not (Test-DriveRoot $Path)) { return $Path }
    $mountRoot = [string] (Get-OptionValue $Options 'mountRoot' '/mnt')
    $mountRoot = $mountRoot -replace '/+$', ''
    $drive = $Path.Substring(0, 1).ToLowerInvariant()
    $rest = $Path.Substring(3)
    if ($rest -eq '') { return $mountRoot + '/' + $drive }
    return $mountRoot + '/' + $drive + '/' + $rest
}

function ConvertTo-CanonicalPosixPath {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Path)

    if ($Path.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'path contains NUL') }
    if (Test-DriveRoot $Path) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'win32 drive paths require an explicit host mapping such as toWSL') }
    if ($Path.Contains('\')) { throw (New-CanonicalPathError 'ERR_INVALID_PATH' 'canonical paths must use slash separators') }
    return $Path
}

function Escape-ReservedWin32Component {
    param([string] $Value)

    $dot = $Value.IndexOf('.')
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

    if ($Name -eq '') { throw (New-CanonicalPathError 'ERR_INVALID_COMPONENT' 'component is empty') }
    if ($Name.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'component contains NUL') }
    $value = $Name -replace '[\\/:\t\n\r]+', '-'
    $value = $value -replace '^[ ._-]+|[ ._-]+$', ''
    if ($value -eq '') { $value = 'component' }
    if ($Profile -eq 'win32') { $value = Escape-ReservedWin32Component $value }
    return $value
}

function New-CanonicalFSDaemonClient {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Endpoint,
        [string] $Token = ''
    )

    $endpointValue = $Endpoint.TrimEnd('/')
    if ($endpointValue -eq '') { throw (New-CanonicalFSDaemonError 'ERR_DAEMON_CLIENT' 'endpoint is empty') }
    return [pscustomobject] @{
        PSTypeName = 'CanonicalPath.CanonicalFSDaemonClient'
        Endpoint = $endpointValue
        Token = $Token
    }
}

function Get-CanonicalFSDaemonClientValue {
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $Name
    )

    $property = $Client.PSObject.Properties[$Name]
    if ($null -eq $property) { throw (New-CanonicalFSDaemonError 'ERR_DAEMON_CLIENT' ('client is missing ' + $Name)) }
    return [string] $property.Value
}

function Invoke-CanonicalFSDaemonRequest {
    param(
        [Parameter(Mandatory = $true)] $Client,
        [Parameter(Mandatory = $true)][string] $Method,
        [Parameter(Mandatory = $true)][string] $Path,
        $Body = $null,
        [switch] $NoAuth
    )

    $endpoint = Get-CanonicalFSDaemonClientValue $Client 'Endpoint'
    $uri = $endpoint + $Path
    $headers = @{}
    $token = Get-CanonicalFSDaemonClientValue $Client 'Token'
    if (-not $NoAuth) {
        if ($token -eq '') { throw (New-CanonicalFSDaemonError 'ERR_DAEMON_CLIENT' 'bearer token is required for this daemon endpoint') }
        $headers['Authorization'] = 'Bearer ' + $token
    }

    $parameters = @{
        Method = $Method
        Uri = $uri
        Headers = $headers
    }
    if ($null -ne $Body) {
        $parameters['ContentType'] = 'application/json'
        $parameters['Body'] = ($Body | ConvertTo-Json -Depth 8)
    }

    try {
        $response = Invoke-RestMethod @parameters
    } catch {
        $statusCode = 0
        $message = $_.Exception.Message
        $code = 'ERR_DAEMON'
        $raw = ''
        if ($null -ne $_.ErrorDetails -and $_.ErrorDetails.Message -ne '') {
            $raw = [string] $_.ErrorDetails.Message
        }
        $httpResponse = $_.Exception.Response
        if ($null -ne $httpResponse) {
            try { $statusCode = [int] $httpResponse.StatusCode } catch { $statusCode = 0 }
            if ($raw -eq '') { try {
                $stream = $httpResponse.GetResponseStream()
                if ($null -ne $stream) {
                    $reader = New-Object System.IO.StreamReader($stream)
                    try { $raw = $reader.ReadToEnd() } finally { $reader.Dispose() }
                }
            } catch {} }
        }
        if ($raw -ne '') {
            try {
                $parsed = $raw | ConvertFrom-Json
                if ($null -ne $parsed.error) {
                    $code = [string] $parsed.error.code
                    $message = [string] $parsed.error.message
                }
            } catch {}
        }
        throw (New-CanonicalFSDaemonError $code $message $statusCode)
    }

    if ($null -ne $response -and $null -ne $response.PSObject.Properties['error'] -and $null -ne $response.error) {
        throw (New-CanonicalFSDaemonError ([string] $response.error.code) ([string] $response.error.message) 0)
    }
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

    if ($Ref -eq '') { throw (New-CanonicalPathError 'ERR_INVALID_COMPONENT' 'git ref is empty') }
    if ($Ref.Contains([string] [char] 0)) { throw (New-CanonicalPathError 'ERR_NUL_BYTE' 'git ref contains NUL') }
    $slug = $Ref -replace '[^A-Za-z0-9._-]+', '-'
    $slug = $slug -replace '^[._-]+|[._-]+$', ''
    if ($slug -eq '') { $slug = 'ref' }

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Ref)
        $hashBytes = $sha.ComputeHash($bytes)
    } finally {
        if ($sha -ne $null) { $sha.Dispose() }
    }
    $hex = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
    return $slug + '--' + $hex.Substring(0, 12)
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
