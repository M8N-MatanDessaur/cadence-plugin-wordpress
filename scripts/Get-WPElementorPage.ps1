<#
.SYNOPSIS
  Fetch the raw Elementor layout JSON for a page or post.

.DESCRIPTION
  Reads _elementor_data for the specified post and prints a summary of the
  widget tree (section count, column count, widget count, widget types used)
  plus the edit URL. Pass -Full to dump the raw parsed JSON instead.

  Use this when you need to understand what is actually on a page before
  suggesting changes. Walking the tree server-side is much faster than
  fetching the rendered HTML and guessing.

.PARAMETER Id
  The post id.

.PARAMETER Type
  The REST base (pages, posts, or any CPT rest base). Default: pages.

.PARAMETER Full
  Dump the full parsed _elementor_data JSON instead of the summary.

.EXAMPLE
  .\Get-WPElementorPage.ps1 -Id 123
.EXAMPLE
  .\Get-WPElementorPage.ps1 -Id 123 -Type posts -Full
#>
param(
    [Parameter(Mandatory = $true)][int]$Id,
    [string]$Type = 'pages',
    [switch]$Full
)

$ErrorActionPreference = 'Stop'
$url = "http://127.0.0.1:3800/api/plugins/wordpress/elementor/page/$Id`?type=$Type"

try {
    $resp = Invoke-RestMethod -Uri $url -Method Get
} catch {
    Write-Error "Failed to fetch Elementor page: $($_.Exception.Message)"
    exit 1
}

if ($Full) {
    $resp | ConvertTo-Json -Depth 20
    exit 0
}

Write-Host ""
Write-Host "Elementor page #$($resp.id): $($resp.title)" -ForegroundColor Cyan
Write-Host ("-" * 80)
Write-Host "Edit mode    : $($resp.editMode)"
Write-Host "Version      : $($resp.version)"
Write-Host "Template type: $($resp.template)"
Write-Host "Public URL   : $($resp.link)"
Write-Host "Edit URL     : $($resp.editUrl)"
Write-Host ""

if (-not $resp.data) {
    Write-Host "No Elementor data on this page. It is either a non-Elementor page or the bridge mu-plugin is not installed." -ForegroundColor Yellow
    Write-Host "Install wp-mu-plugin/symphonee-bridge.php on the site to expose _elementor_data via REST." -ForegroundColor Yellow
    exit 0
}

# Walk the tree and count elements
$sections = 0
$columns = 0
$widgets = 0
$widgetTypes = @{}

function Walk-Node($node) {
    if (-not $node) { return }
    if ($node.elType -eq 'section' -or $node.elType -eq 'container') { $script:sections++ }
    elseif ($node.elType -eq 'column') { $script:columns++ }
    elseif ($node.elType -eq 'widget') {
        $script:widgets++
        $t = $node.widgetType
        if ($t) {
            if ($script:widgetTypes.ContainsKey($t)) { $script:widgetTypes[$t]++ }
            else { $script:widgetTypes[$t] = 1 }
        }
    }
    if ($node.elements) {
        foreach ($child in $node.elements) { Walk-Node $child }
    }
}

foreach ($top in $resp.data) { Walk-Node $top }

Write-Host "Layout summary" -ForegroundColor Cyan
Write-Host "  Sections/containers: $sections"
Write-Host "  Columns            : $columns"
Write-Host "  Widgets            : $widgets"
Write-Host ""
Write-Host "Widget types used" -ForegroundColor Cyan
$widgetTypes.GetEnumerator() | Sort-Object -Property Value -Descending | ForEach-Object {
    $n = "{0,4}" -f $_.Value
    Write-Host "  $n  $($_.Key)"
}
Write-Host ""
Write-Host "Pass -Full to see the complete parsed JSON." -ForegroundColor DarkGray
