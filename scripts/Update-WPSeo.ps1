<#
.SYNOPSIS
  Update SEO metadata (Yoast + RankMath) for a post or page.

.PARAMETER Id
  Post or page ID.

.PARAMETER Type
  'posts' or 'pages'. Default: posts.

.PARAMETER Title
  SEO title (50-60 chars ideal).

.PARAMETER Description
  Meta description (140-160 chars ideal).

.PARAMETER FocusKeyword
  Focus keyword phrase.

.PARAMETER Canonical
  Canonical URL.

.EXAMPLE
  .\Update-WPSeo.ps1 -Id 42 -Title "Best Mountain Recipes" -Description "12 easy recipes..." -FocusKeyword "mountain recipes"
#>
param(
    [Parameter(Mandatory = $true)][int]$Id,
    [ValidateSet('posts', 'pages')][string]$Type = 'posts',
    [string]$Title,
    [string]$Description,
    [string]$FocusKeyword,
    [string]$Canonical
)

$ErrorActionPreference = 'Stop'
$url = "http://127.0.0.1:3800/api/plugins/wordpress/seo/$Type/$Id"

$yoast = @{}
$rm = @{}
if ($Title) { $yoast.title = $Title; $rm.title = $Title }
if ($Description) { $yoast.metadesc = $Description; $rm.description = $Description }
if ($FocusKeyword) { $yoast.focuskw = $FocusKeyword; $rm.focus_keyword = $FocusKeyword }
if ($Canonical) { $yoast.canonical = $Canonical; $rm.canonical_url = $Canonical }

if ($yoast.Count -eq 0) {
    Write-Error "No SEO fields provided."
    exit 1
}

$body = @{ yoast = $yoast; rankmath = $rm } | ConvertTo-Json -Depth 4 -Compress

try {
    $resp = Invoke-RestMethod -Uri $url -Method Put -Body $body -ContentType 'application/json'
    Write-Host "Updated SEO for $Type #$Id" -ForegroundColor Green
    Write-Host "  Title:       $Title"
    Write-Host "  Description: $Description"
} catch {
    Write-Error "Failed: $($_.Exception.Message)"
    exit 1
}
