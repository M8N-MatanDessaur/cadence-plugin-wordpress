<#
.SYNOPSIS
  Print a site health summary for the configured WordPress site.

.DESCRIPTION
  Hits /api/plugins/wordpress/site/health and prints counts, detected
  plugins, and a list of issues (missing alt text, pending comments, etc).
  Useful as a first-run check when you sit down to work on a site.

.PARAMETER Json
  Return raw JSON instead of a formatted report.

.EXAMPLE
  .\Get-WPSiteHealth.ps1
#>
param(
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:3800/api/plugins/wordpress/site/health'

try {
    $resp = Invoke-RestMethod -Uri $url -Method Get
} catch {
    Write-Error "Failed to fetch site health: $($_.Exception.Message)"
    exit 1
}

if ($Json) {
    $resp | ConvertTo-Json -Depth 5
    exit 0
}

Write-Host ""
Write-Host "Site: $($resp.site.name)" -ForegroundColor Cyan
if ($resp.site.description) { Write-Host "  $($resp.site.description)" -ForegroundColor DarkGray }
Write-Host "  $($resp.site.url)"
Write-Host ""

Write-Host "Counts" -ForegroundColor Cyan
Write-Host ("-" * 40)
Write-Host ("  Posts              : {0}" -f $resp.counts.posts)
Write-Host ("  Pages              : {0}" -f $resp.counts.pages)
Write-Host ("  Media              : {0}" -f $resp.counts.media)
Write-Host ("  Drafts             : {0}" -f $resp.counts.drafts)
Write-Host ("  Pending comments   : {0}" -f $resp.counts.pendingComments)
Write-Host ""

if ($resp.plugins -and $resp.plugins.Count -gt 0) {
    Write-Host "Detected plugins" -ForegroundColor Cyan
    Write-Host ("-" * 40)
    foreach ($p in $resp.plugins) {
        $caps = if ($p.capabilities) { " (" + ($p.capabilities -join ', ') + ")" } else { "" }
        Write-Host "  $($p.label)$caps"
    }
    Write-Host ""
}

if ($resp.issues -and $resp.issues.Count -gt 0) {
    Write-Host "Issues" -ForegroundColor Yellow
    Write-Host ("-" * 40)
    foreach ($i in $resp.issues) {
        $prefix = switch ($i.level) {
            'warn'  { '[WARN]' }
            'error' { '[ERR] ' }
            default { '[INFO]' }
        }
        Write-Host "  $prefix  $($i.message)"
    }
    Write-Host ""
} else {
    Write-Host "No issues detected." -ForegroundColor Green
}
