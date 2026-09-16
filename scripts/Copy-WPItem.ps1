<#
.SYNOPSIS
    Duplicates an item as a new draft, page-builder layout and SEO fields included.
.EXAMPLE
    ./scripts/Copy-WPItem.ps1 -Type pages -Id 28
#>
[CmdletBinding()]
param(
    [string]$Type = 'pages',
    [Parameter(Mandatory)][int]$Id,
    [string]$Title = '',
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
$it = Get-Api "/api/plugins/wordpress/item?type=$(Esc $Type)&id=$Id"
$body = @{ title = $(if ($Title) { $Title } else { "$($it.title) (copy)" }); status = 'draft'; content = $it.content; excerpt = $it.excerptRaw; featured_media = $it.featuredMedia; parent = $it.parent; meta = @{} }
foreach ($k in '_elementor_data','_elementor_edit_mode','_elementor_version','_elementor_template_type','_yoast_wpseo_title','_yoast_wpseo_metadesc','rank_math_title','rank_math_description') { if ($null -ne $it.meta.$k) { $body.meta[$k] = $it.meta.$k } }
foreach ($p in $it.terms.PSObject.Properties) { $body[$p.Name] = @($p.Value.selected) }
$r = Fail-IfWpError (Post-Api "/api/plugins/wordpress/content/$(Esc $Type)" $body)
[pscustomobject]@{ ok = [bool]$r.id; id = $r.id; status = $r.status; link = $r.link } | ConvertTo-Json
