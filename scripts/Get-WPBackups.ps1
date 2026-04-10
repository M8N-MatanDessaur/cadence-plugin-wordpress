<#
.SYNOPSIS
    List snapshots saved by the WordPress plugin.

.DESCRIPTION
    Returns the plugin's local backup index. Use -RestBase and -Id to
    filter to snapshots of a single item, otherwise every recent snapshot
    is shown.

.EXAMPLE
    .\scripts\Get-WPBackups.ps1
    .\scripts\Get-WPBackups.ps1 -RestBase pages -Id 12
#>
[CmdletBinding()]
param(
    [string]$RestBase,
    [int]$Id,
    [int]$Limit = 50,
    [string]$ApiBase = 'http://127.0.0.1:3800/api/plugins/wordpress'
)

$ErrorActionPreference = 'Stop'

$url = if ($RestBase -and $Id) {
    "$ApiBase/backups/$RestBase/$Id"
} else {
    "$ApiBase/backups"
}

try {
    $r = Invoke-RestMethod -Uri $url -Method GET
} catch {
    Write-Error ("Could not list backups: " + $_.Exception.Message)
    exit 1
}

$items = @($r.items)
if ($items.Count -eq 0) {
    Write-Host "No snapshots found."
    return
}

$items | Select-Object -First $Limit | ForEach-Object {
    [pscustomobject]@{
        backupId  = $_.backupId
        restBase  = $_.restBase
        id        = $_.id
        title     = $_.title
        status    = $_.status
        reason    = $_.reason
        timestamp = $_.timestamp
    }
} | Format-Table -AutoSize
