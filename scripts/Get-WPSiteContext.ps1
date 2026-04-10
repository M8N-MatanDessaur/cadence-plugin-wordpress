<#
.SYNOPSIS
    Dump a plain-text snapshot of the full WordPress site context for the AI.

.DESCRIPTION
    Calls /api/plugins/wordpress/discover and /context/full and prints a
    human-readable summary of every post type, taxonomy, detected plugin,
    active theme, menus, and namespaces. Use this as the first stop when
    you want the AI to understand what a given WordPress site is made of.

.EXAMPLE
    .\scripts\Get-WPSiteContext.ps1
    .\scripts\Get-WPSiteContext.ps1 -Json
#>
[CmdletBinding()]
param(
    [switch]$Json,
    [string]$ApiBase = 'http://127.0.0.1:3800/api/plugins/wordpress'
)

$ErrorActionPreference = 'Stop'

try {
    $discover = Invoke-RestMethod -Uri ($ApiBase + '/discover') -Method GET
    $full     = Invoke-RestMethod -Uri ($ApiBase + '/context/full') -Method GET
} catch {
    Write-Error ("Failed to reach the WordPress plugin API: " + $_.Exception.Message)
    exit 1
}

if ($Json) {
    [pscustomobject]@{
        discover = $discover
        context  = $full
    } | ConvertTo-Json -Depth 12
    return
}

$lines = New-Object System.Collections.Generic.List[string]
$add = { param($t) $lines.Add($t) | Out-Null }

& $add ("WordPress Site Context")
& $add ("======================")
& $add ("")
& $add ("Site:        " + $full.site.url)
& $add ("Name:        " + $full.site.name)
& $add ("Tagline:     " + $full.site.description)
if ($full.site.timezone_string) { & $add ("Timezone:    " + $full.site.timezone_string) }
& $add ("")

if ($full.theme) {
    & $add ("Active theme")
    & $add ("------------")
    & $add ("  Name:       " + $full.theme.name)
    & $add ("  Stylesheet: " + $full.theme.stylesheet)
    & $add ("  Template:   " + $full.theme.template)
    & $add ("  Version:    " + $full.theme.version)
    & $add ("")
}

if ($full.plugins -and $full.plugins.Count -gt 0) {
    & $add ("Active plugins (" + $full.plugins.Count + ")")
    & $add ("---------------")
    foreach ($p in $full.plugins) {
        & $add ("  [" + $p.status + "] " + $p.name + "  v" + $p.version + "  (" + $p.plugin + ")")
    }
    & $add ("")
}

if ($discover.plugins -and $discover.plugins.Count -gt 0) {
    & $add ("Detected REST integrations (from namespaces)")
    & $add ("--------------------------------------------")
    foreach ($p in $discover.plugins) {
        & $add ("  - " + $p.label + "  [" + $p.id + "]  capabilities: " + ($p.capabilities -join ', '))
    }
    & $add ("")
}

if ($discover.postTypes) {
    & $add ("Post types")
    & $add ("----------")
    foreach ($pt in ($discover.postTypes | Sort-Object -Property count -Descending)) {
        $src = if ($pt.source -eq 'core') { 'core' } else { 'custom' }
        $line = "  {0,-24} count: {1,-6} rest: {2,-20} ({3})" -f $pt.slug, $pt.count, $pt.restBase, $src
        & $add $line
    }
    & $add ("")
}

if ($discover.taxonomies) {
    & $add ("Taxonomies")
    & $add ("----------")
    foreach ($tx in ($discover.taxonomies | Sort-Object -Property count -Descending)) {
        $types = if ($tx.types) { ($tx.types -join ',') } else { '' }
        $line = "  {0,-22} count: {1,-6} rest: {2,-18} attaches to: {3}" -f $tx.slug, $tx.count, $tx.restBase, $types
        & $add $line
    }
    & $add ("")
}

& $add ("Comments: " + $discover.commentCount)
& $add ("Users:    " + $discover.userCount)
& $add ("")

if ($full.namespaces -and $full.namespaces.Count -gt 0) {
    & $add ("REST namespaces")
    & $add ("---------------")
    foreach ($ns in ($full.namespaces | Sort-Object)) {
        & $add ("  " + $ns)
    }
    & $add ("")
}

if ($full.menus -and $full.menus.Count -gt 0) {
    & $add ("Menus (" + $full.menus.Count + ")")
    foreach ($m in $full.menus) {
        & $add ("  - " + $m.name + " (id:" + $m.id + ")")
    }
    & $add ("")
}

$lines -join "`n"
