<#
.SYNOPSIS
    Comments by status (hold = awaiting moderation).
.EXAMPLE
    ./scripts/Get-WPComments.ps1 -Status hold
#>
[CmdletBinding()]
param(
    [ValidateSet('hold','approve','spam','trash','all')][string]$Status = 'hold',
    [int]$Limit = 50,
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
$r = Get-Api "/api/plugins/wordpress/comments?status=$Status&per_page=$Limit&_fields=id,post,parent,author_name,author_email,date,content,status,link"
Out-Json @($r.items | ForEach-Object { [pscustomobject]@{ id = $_.id; post = $_.post; author = $_.author_name; email = $_.author_email; status = $_.status; date = $_.date; text = ($_.content.rendered -replace '<[^>]+>', '').Trim(); link = $_.link } }) 4
