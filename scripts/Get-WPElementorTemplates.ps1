<#
.SYNOPSIS
  List every Elementor library template on the configured WordPress site.

.DESCRIPTION
  Hits /api/plugins/wordpress/elementor/templates and prints a readable
  table. Templates include saved pages, sections, headers, footers, popups,
  and individual widgets. Each row shows the template id, its type, slug,
  status, and the direct edit URL.

  Use this before any "build a page like the homepage" workflow so you can
  pick a known-good starting point.

.PARAMETER Type
  Filter by template type: page, section, header, footer, popup, widget.
  Omit to see everything.

.PARAMETER Json
  Return raw JSON instead of a formatted table. Useful when piping to other
  scripts or to the AI terminal.

.EXAMPLE
  .\Get-WPElementorTemplates.ps1
.EXAMPLE
  .\Get-WPElementorTemplates.ps1 -Type header
.EXAMPLE
  .\Get-WPElementorTemplates.ps1 -Json
#>
param(
    [string]$Type,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:3800/api/plugins/wordpress/elementor/templates'

try {
    $resp = Invoke-RestMethod -Uri $url -Method Get
} catch {
    Write-Error "Failed to fetch Elementor templates: $($_.Exception.Message)"
    Write-Host "Is Elementor active on the site? Check /discover." -ForegroundColor Yellow
    exit 1
}

$items = $resp.items
if ($Type) {
    $items = $items | Where-Object { $_.type -eq $Type }
}

if ($Json) {
    $items | ConvertTo-Json -Depth 5
    exit 0
}

if (-not $items -or $items.Count -eq 0) {
    Write-Host "No Elementor templates found$(if ($Type) { " of type '$Type'" })." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Elementor library ($($items.Count) template$(if ($items.Count -ne 1) {'s'}))" -ForegroundColor Cyan
Write-Host ("-" * 80)
$items | ForEach-Object {
    $id = "{0,6}" -f $_.id
    $type = "{0,-10}" -f $_.type
    $status = "{0,-8}" -f $_.status
    Write-Host "$id  $type  $status  $($_.title)"
}
Write-Host ""
Write-Host "Tip: pass -Json to pipe to another script, or -Type to filter." -ForegroundColor DarkGray
