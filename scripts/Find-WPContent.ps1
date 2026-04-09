<#
.SYNOPSIS
  Search WordPress posts and pages.

.PARAMETER Query
  Search text.

.PARAMETER Type
  Restrict to 'post' or 'page'. Omit for all.

.EXAMPLE
  .\Find-WPContent.ps1 -Query "recipe"
#>
param(
    [Parameter(Mandatory = $true)][string]$Query,
    [ValidateSet('post', 'page', '')][string]$Type = ''
)

$ErrorActionPreference = 'Stop'
$q = [System.Uri]::EscapeDataString($Query)
$url = "http://127.0.0.1:3800/api/plugins/wordpress/search?q=$q"
if ($Type) { $url += "&type=$Type" }

try {
    $resp = Invoke-RestMethod -Uri $url
    if (-not $resp -or $resp.Count -eq 0) {
        Write-Host "No results." -ForegroundColor Yellow
        return
    }
    Write-Host "$($resp.Count) result(s):" -ForegroundColor Green
    foreach ($r in $resp) {
        Write-Host ""
        Write-Host "  [$($r.type)] $($r.title)" -ForegroundColor Cyan
        Write-Host "    id: $($r.id)"
        Write-Host "    url: $($r.url)"
    }
} catch {
    Write-Error "Search failed: $($_.Exception.Message)"
    exit 1
}
