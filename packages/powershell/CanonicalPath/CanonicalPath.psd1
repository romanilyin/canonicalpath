@{
    RootModule = 'CanonicalPath.psm1'
    ModuleVersion = '0.1.0'
    GUID = '1a710e8f-44b8-4b3e-a0dc-7fe1a3eaab75'
    Author = 'CanonicalPath contributors'
    CompanyName = 'CanonicalPath contributors'
    Copyright = '(c) CanonicalPath contributors. All rights reserved.'
    Description = 'Experimental lexical CanonicalPath module with typed CanonicalFS daemon HTTP client helpers. Does not provide local filesystem security.'
    PowerShellVersion = '5.1'
    FunctionsToExport = @(
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
    CmdletsToExport = @()
    VariablesToExport = @()
    AliasesToExport = @()
    PrivateData = @{
        PSData = @{
            Tags = @('CanonicalPath', 'CanonicalFS', 'lexical', 'paths', 'daemon-client')
            ProjectUri = 'https://github.com/canonicalpath/canonicalpath'
        }
    }
}
