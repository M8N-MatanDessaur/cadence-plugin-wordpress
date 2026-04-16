<#
.SYNOPSIS
  Download the Symphonee bridge mu-plugin to the current directory so you
  can upload it to the target WordPress site.

.DESCRIPTION
  The bridge mu-plugin (symphonee-bridge.php) registers page-builder meta
  keys with show_in_rest=true so the Symphonee WordPress plugin can
  reliably READ and WRITE Elementor, Breakdance, Bricks, Beaver, and Divi
  layouts via REST. Without it, writes to _elementor_data silently fail even
  though the API returns 200.

  This script fetches the file from the local plugin and writes it to the
  current directory. You then upload it to wp-content/mu-plugins/ on the
  target site, either via SFTP, the cPanel file manager, or a plugin like
  Advanced File Manager. No activation needed, mu-plugins load automatically.

  After installation, call Test-WPBridge.ps1 to verify the site reports the
  new REST namespace.

.PARAMETER Out
  Path to write the file. Default: .\symphonee-bridge.php

.EXAMPLE
  .\Install-WPBridge.ps1
.EXAMPLE
  .\Install-WPBridge.ps1 -Out C:\downloads\bridge.php
#>
param(
    [string]$Out = '.\symphonee-bridge.php'
)

$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:3800/api/plugins/wordpress/bridge/mu-plugin'

try {
    Invoke-WebRequest -Uri $url -OutFile $Out -UseBasicParsing
} catch {
    Write-Error "Failed to download bridge: $($_.Exception.Message)"
    exit 1
}

$resolved = (Resolve-Path $Out).Path
Write-Host ""
Write-Host "Downloaded bridge mu-plugin to:" -ForegroundColor Green
Write-Host "  $resolved"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Upload the file to wp-content/mu-plugins/ on the target WordPress site."
Write-Host "     (Create the mu-plugins directory if it does not already exist.)"
Write-Host "  2. No activation needed. mu-plugins load automatically."
Write-Host "  3. Verify: .\scripts\Test-WPBridge.ps1"
Write-Host ""
