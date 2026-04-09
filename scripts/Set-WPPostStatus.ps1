<#
.SYNOPSIS
  Change the status of a WordPress post or page.

.PARAMETER Id
  Post or page ID.

.PARAMETER Status
  draft, publish, pending, private, future, trash.

.PARAMETER Type
  'posts' or 'pages'. Default: posts.

.EXAMPLE
  .\Set-WPPostStatus.ps1 -Id 42 -Status publish
#>
param(
    [Parameter(Mandatory = $true)][int]$Id,
    [Parameter(Mandatory = $true)][ValidateSet('draft', 'publish', 'pending', 'private', 'future', 'trash')][string]$Status,
    [ValidateSet('posts', 'pages')][string]$Type = 'posts'
)

$ErrorActionPreference = 'Stop'
$url = "http://127.0.0.1:3800/api/plugins/wordpress/$Type/$Id"
$body = @{ status = $Status } | ConvertTo-Json -Compress

try {
    $resp = Invoke-RestMethod -Uri $url -Method Put -Body $body -ContentType 'application/json'
    Write-Host "Updated $Type #$Id -> $Status" -ForegroundColor Green
    Write-Host "  Title: $($resp.title.rendered)"
    Write-Host "  Link:  $($resp.link)"
} catch {
    Write-Error "Failed: $($_.Exception.Message)"
    exit 1
}
