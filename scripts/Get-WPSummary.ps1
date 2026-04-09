<#
.SYNOPSIS
  Print a plain-text summary of the configured WordPress site.

.DESCRIPTION
  Hits /api/plugins/wordpress/summary and prints the result.
#>
param()

$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:3800/api/plugins/wordpress/summary'
try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing
    Write-Output $r.Content
} catch {
    Write-Error "Failed to fetch WordPress summary: $($_.Exception.Message)"
    exit 1
}
