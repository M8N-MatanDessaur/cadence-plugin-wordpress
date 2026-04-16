<#
.SYNOPSIS
  List every Breakdance template, header, footer, popup, and block on the
  configured WordPress site.

.DESCRIPTION
  Queries the Breakdance CPT endpoints via the Symphonee plugin proxy and
  prints a readable grouped table. Use this before building a new page so
  you can reference existing headers / footers / sections rather than
  rebuilding from scratch.

.PARAMETER Json
  Return raw JSON instead of a formatted grouping.

.EXAMPLE
  .\Get-WPBreakdanceTemplates.ps1
.EXAMPLE
  .\Get-WPBreakdanceTemplates.ps1 -Json
#>
param(
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:3800/api/plugins/wordpress/breakdance/templates'

try {
    $resp = Invoke-RestMethod -Uri $url -Method Get
} catch {
    Write-Error "Failed to fetch Breakdance templates: $($_.Exception.Message)"
    Write-Host "Is Breakdance active on the site? Check /discover." -ForegroundColor Yellow
    exit 1
}

if ($Json) {
    $resp | ConvertTo-Json -Depth 5
    exit 0
}

$labels = @{
    'breakdance_template' = 'Templates'
    'breakdance_header'   = 'Headers'
    'breakdance_footer'   = 'Footers'
    'breakdance_popup'    = 'Popups'
    'breakdance_block'    = 'Blocks'
}

$anything = $false
foreach ($key in $labels.Keys) {
    $items = $resp.$key
    if (-not $items) { continue }
    $anything = $true
    Write-Host ""
    Write-Host "$($labels[$key]) ($($items.Count))" -ForegroundColor Cyan
    Write-Host ("-" * 60)
    foreach ($it in $items) {
        $id = "{0,6}" -f $it.id
        $status = "{0,-8}" -f $it.status
        Write-Host "$id  $status  $($it.title)"
    }
}

if (-not $anything) {
    Write-Host "No Breakdance templates found. Is Breakdance installed on the site?" -ForegroundColor Yellow
}
