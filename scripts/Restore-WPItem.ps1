<#
.SYNOPSIS
    Restore a WordPress item from a previously saved snapshot.

.DESCRIPTION
    Calls /api/plugins/wordpress/restore/:backupId. Before restoring, the
    plugin automatically takes a safety snapshot of the current state so
    you can undo the restore if needed. Use Get-WPBackups.ps1 to list the
    available snapshots.

.PARAMETER BackupId
    The snapshot identifier, e.g. '2026-04-09T12-00-00-000Z-pages-12'.

.EXAMPLE
    .\scripts\Restore-WPItem.ps1 -BackupId '2026-04-09T12-00-00-000Z-pages-12'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BackupId,
    [string]$ApiBase = 'http://127.0.0.1:3800/api/plugins/wordpress'
)

$ErrorActionPreference = 'Stop'

try {
    $r = Invoke-RestMethod -Uri ($ApiBase + '/restore/' + $BackupId) -Method POST
} catch {
    Write-Error ("Restore failed: " + $_.Exception.Message)
    exit 1
}

if ($r.ok) {
    Write-Host "Item restored from snapshot" -ForegroundColor Green
    if ($r.data -and $r.data.id) { Write-Host ("  id:     " + $r.data.id) }
    if ($r.data -and $r.data.link) { Write-Host ("  link:   " + $r.data.link) }
    if ($r.data -and $r.data.status) { Write-Host ("  status: " + $r.data.status) }
} else {
    Write-Error ("Restore failed: " + ($r.error))
    exit 1
}
