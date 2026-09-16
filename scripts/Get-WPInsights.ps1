<#
.SYNOPSIS
    Every item with a problem: drafts, pending, scheduled, stale, missing or long meta title and description, noindex, thin, no featured image, no excerpt.
.EXAMPLE
    ./scripts/Get-WPInsights.ps1 -Kind missing-seo-description
#>
[CmdletBinding()]
param(
    [string]$Kind = '',
    [string]$Site = ''
)
$ErrorActionPreference = 'Stop'
$CadenceApi = if ($env:CADENCE_API) { $env:CADENCE_API } else { 'http://127.0.0.1:3800' }
$headers = @{}
if ($env:CADENCE_TOKEN) { $headers['x-cadence-token'] = $env:CADENCE_TOKEN }
# -Site names one of the configured WordPress sites; blank means the active one (or the one whose repository the shell is on).
$siteQ = if ($PSBoundParameters.ContainsKey('Site') -and $Site) { "site=$([uri]::EscapeDataString($Site))" } elseif ($env:CADENCE_ACTIVE_REPO_PATH) { "repo=$([uri]::EscapeDataString($env:CADENCE_ACTIVE_REPO_PATH))" } else { '' }
function With-Site($path) { if (-not $siteQ) { return $path }; if ($path.Contains('?')) { "$path&$siteQ" } else { "$path?$siteQ" } }
function Get-Api($path) { Invoke-RestMethod -Uri "$CadenceApi$(With-Site $path)" -Headers $headers -TimeoutSec 300 }
function Get-Text($path) { (Invoke-WebRequest -UseBasicParsing -Uri "$CadenceApi$(With-Site $path)" -Headers $headers -TimeoutSec 300).Content }
function Send-Api($method, $path, $payload) { $args = @{ Uri = "$CadenceApi$(With-Site $path)"; Method = $method; Headers = $headers; TimeoutSec = 300 }; if ($null -ne $payload) { $args.ContentType = 'application/json; charset=utf-8'; $args.Body = [System.Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 20)) }; Invoke-RestMethod @args }
function Post-Api($path, $payload) { Send-Api 'POST' $path $payload }
function Esc($s) { [uri]::EscapeDataString([string]$s) }
# -InputObject, not the pipeline: Windows PowerShell 5.1 wraps a piped JSON array in a {value, Count} object, and an empty one prints nothing.
function Out-Json($o, $d = 12) { ConvertTo-Json -InputObject $o -Depth $d }
function Read-JsonFile($file) { if (-not (Test-Path $file)) { throw "File not found: $file" }; ConvertFrom-Json -InputObject (Get-Content $file -Raw -Encoding UTF8) }
function Fail-IfWpError($r) { if ($r -and $r.code -and $r.message -and -not $r.id) { throw "WordPress: $($r.message) ($($r.code))" }; $r }
$d = Get-Api '/api/plugins/wordpress/insights'
if ($Kind) { $d.entries = @($d.entries | Where-Object { $_.issues -contains $Kind }) }
$d | ConvertTo-Json -Depth 8
