<#
.SYNOPSIS
    Take a manual snapshot of a WordPress item (post, page, or any CPT).

.DESCRIPTION
    Calls /api/plugins/wordpress/backup to create a JSON snapshot of the
    item in its full editable state. The snapshot is stored in the plugin
    backups/ directory and can be restored later with Restore-WPItem.ps1.

    Automatic backups are also taken by the plugin before every edit and
    every delete, so you do not normally need to call this by hand. Use
    this when you want an explicit pre-change checkpoint.

.PARAMETER RestBase
    The REST base of the content type (e.g. 'posts', 'pages', 'product',
    'elementor_library'). Find it with Get-WPSiteContext.ps1.

.PARAMETER Id
    Numeric ID of the item to back up.

.PARAMETER Reason
    Optional human-readable reason, e.g. 'before rewrite'.

.EXAMPLE
    .\scripts\Backup-WPItem.ps1 -RestBase pages -Id 12
    .\scripts\Backup-WPItem.ps1 -RestBase product -Id 448 -Reason 'pre-price-update'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RestBase,
    [Parameter(Mandatory)][int]$Id,
    [string]$Reason = 'manual',
    [string]$ApiBase = 'http://127.0.0.1:3800/api/plugins/wordpress'
)

$ErrorActionPreference = 'Stop'

$body = @{ restBase = $RestBase; id = $Id; reason = $Reason } | ConvertTo-Json
try {
    $r = Invoke-RestMethod -Uri ($ApiBase + '/backup') -Method POST -ContentType 'application/json' -Body $body
} catch {
    Write-Error ("Backup failed: " + $_.Exception.Message)
    exit 1
}

if ($r.ok) {
    $b = $r.backup
    Write-Host "Snapshot saved" -ForegroundColor Green
    Write-Host ("  backupId: " + $b.backupId)
    Write-Host ("  title:    " + $b.title)
    Write-Host ("  status:   " + $b.status)
    Write-Host ("  reason:   " + $b.reason)
    Write-Host ("  taken:    " + $b.timestamp)
} else {
    Write-Error ("Backup failed: " + ($r.error))
    exit 1
}
