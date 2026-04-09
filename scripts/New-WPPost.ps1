<#
.SYNOPSIS
  Create a WordPress post (defaults to draft).

.PARAMETER Title
  Post title.

.PARAMETER Content
  HTML body. If omitted, opens an empty draft.

.PARAMETER Status
  draft, publish, pending, private, future. Default: draft.

.PARAMETER Excerpt
  Short summary for feeds and SEO.

.PARAMETER Categories
  Comma-separated category IDs (e.g. "5,8").

.PARAMETER Tags
  Comma-separated tag IDs.

.PARAMETER FeaturedMedia
  Media item ID to use as featured image.

.EXAMPLE
  .\New-WPPost.ps1 -Title "Hello" -Content "<p>World</p>"
#>
param(
    [Parameter(Mandatory = $true)][string]$Title,
    [string]$Content = '<p></p>',
    [ValidateSet('draft', 'publish', 'pending', 'private', 'future')][string]$Status = 'draft',
    [string]$Excerpt,
    [string]$Categories,
    [string]$Tags,
    [int]$FeaturedMedia
)

$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:3800/api/plugins/wordpress/posts'

$body = @{
    title   = $Title
    content = $Content
    status  = $Status
}
if ($Excerpt) { $body.excerpt = $Excerpt }
if ($Categories) { $body.categories = $Categories.Split(',') | ForEach-Object { [int]$_.Trim() } }
if ($Tags) { $body.tags = $Tags.Split(',') | ForEach-Object { [int]$_.Trim() } }
if ($FeaturedMedia) { $body.featured_media = $FeaturedMedia }

$json = $body | ConvertTo-Json -Depth 8 -Compress

try {
    $resp = Invoke-RestMethod -Uri $url -Method Post -Body $json -ContentType 'application/json'
    Write-Host "Created post #$($resp.id): $($resp.title.rendered)" -ForegroundColor Green
    Write-Host "  Status: $($resp.status)"
    Write-Host "  Link:   $($resp.link)"
    $resp | ConvertTo-Json -Depth 4
} catch {
    Write-Error "Failed to create post: $($_.Exception.Message)"
    exit 1
}
