<#
.SYNOPSIS
  Check whether the DevOps Pilot bridge mu-plugin is installed on the
  configured WordPress site.

.DESCRIPTION
  Hits /api/plugins/wordpress/bridge/status which inspects the remote WP
  REST root for the devops-pilot/v1 namespace. If the namespace is present,
  the bridge is live and Elementor/Breakdance writes will persist. If not,
  run Install-WPBridge.ps1 and upload the file to wp-content/mu-plugins/.

.EXAMPLE
  .\Test-WPBridge.ps1
#>
param()

$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:3800/api/plugins/wordpress/bridge/status'

try {
    $resp = Invoke-RestMethod -Uri $url -Method Get
} catch {
    Write-Error "Failed to check bridge status: $($_.Exception.Message)"
    exit 1
}

if ($resp.installed) {
    Write-Host ""
    Write-Host "Bridge mu-plugin is INSTALLED and active." -ForegroundColor Green
    Write-Host "Elementor and Breakdance writes via REST should persist correctly."
    Write-Host ""
    exit 0
} else {
    Write-Host ""
    Write-Host "Bridge mu-plugin is NOT installed." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To install:" -ForegroundColor Cyan
    Write-Host "  1. .\scripts\Install-WPBridge.ps1"
    Write-Host "  2. Upload the downloaded file to wp-content/mu-plugins/ on the site"
    Write-Host "  3. Run this script again to verify"
    Write-Host ""
    if ($resp.error) { Write-Host "Error: $($resp.error)" -ForegroundColor DarkGray }
    exit 1
}
