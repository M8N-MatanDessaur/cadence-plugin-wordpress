<#
.SYNOPSIS
  Clone an Elementor page or template into a new draft.

.DESCRIPTION
  Copies _elementor_data and related meta from a source post to a brand new
  draft. Use this as the starting point for "build me a page like X but for
  Y" workflows: clone the reference, then iterate on the new draft.

  The new draft is created with status=draft so nothing goes live until you
  explicitly publish it. The script prints the new id and the Elementor edit
  URL so you can jump straight into editing.

.PARAMETER SourceId
  The post id to clone FROM.

.PARAMETER Title
  Title of the new draft. If omitted, uses "Clone of <source title>".

.PARAMETER SourceType
  REST base of the source (pages, posts, elementor_library, ...). Default: pages.

.PARAMETER TargetType
  REST base of the target (usually the same as source). Default: pages.

.EXAMPLE
  .\Copy-WPElementorPage.ps1 -SourceId 123 -Title "Homepage -- Montreal"
.EXAMPLE
  .\Copy-WPElementorPage.ps1 -SourceId 45 -SourceType elementor_library -TargetType pages -Title "New landing page"
#>
param(
    [Parameter(Mandatory = $true)][int]$SourceId,
    [string]$Title,
    [string]$SourceType = 'pages',
    [string]$TargetType = 'pages'
)

$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:3800/api/plugins/wordpress/elementor/clone'

$body = @{
    sourceId   = $SourceId
    sourceType = $SourceType
    targetType = $TargetType
}
if ($Title) { $body.title = $Title }

$json = $body | ConvertTo-Json -Compress

try {
    $resp = Invoke-RestMethod -Uri $url -Method Post -Body $json -ContentType 'application/json'
} catch {
    Write-Error "Clone failed: $($_.Exception.Message)"
    exit 1
}

if (-not $resp.ok) {
    Write-Error "Clone failed with status $($resp.status)"
    $resp | ConvertTo-Json -Depth 5
    exit 1
}

Write-Host ""
Write-Host "Cloned #$SourceId -> new draft #$($resp.newId)" -ForegroundColor Green
Write-Host "Edit URL: $($resp.editUrl)"
Write-Host ""
Write-Host "Open in Elementor, iterate on the copy, then publish when ready." -ForegroundColor DarkGray
Write-Host "If the editor opens without the cloned layout, install the bridge mu-plugin:" -ForegroundColor Yellow
Write-Host "  curl -s http://127.0.0.1:3800/api/plugins/wordpress/bridge/mu-plugin -o devops-pilot-bridge.php" -ForegroundColor Yellow
Write-Host "  Then upload it to wp-content/mu-plugins/ on the target site." -ForegroundColor Yellow
