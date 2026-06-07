$ErrorActionPreference = "Stop"

$Workspace = "E:\PUAsimulator"
$Node = "E:\nodejs\node.exe"
$GatewayScript = Join-Path $Workspace "kpi-agent-gateway.js"
$GatewayPort = 8787
$GatewayUrl = "http://127.0.0.1:$GatewayPort"
$GatewayKeyPath = Join-Path $Workspace "kpi-agent-gateway-key.txt"
$TunnelConfig = Join-Path $Workspace "kpi-agent-cloudflared.yml"
$TunnelLog = Join-Path $Workspace "kpi-agent-named-cloudflared.log"
$TunnelUrlPath = Join-Path $Workspace "kpi-cloudflared-url.txt"
$PublicBase = "https://kpi.9star.cc"
$TunnelName = "kpi-agent"

function Find-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
        "$env:ProgramFiles\cloudflared\cloudflared.exe",
        "$env:ProgramFiles\Cloudflare\cloudflared.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

function Ensure-Gateway {
    $existing = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
        Where-Object { $_.CommandLine -like "*kpi-agent-gateway.js*" } |
        Select-Object -First 1

    if (-not $existing) {
        Start-Process -FilePath $Node -ArgumentList "`"$GatewayScript`"" -WorkingDirectory $Workspace -WindowStyle Hidden | Out-Null
        Start-Sleep -Seconds 2
    }

    Invoke-RestMethod -Uri "$GatewayUrl/health" -Method Get -TimeoutSec 10 | Out-Null
}

function Start-Tunnel {
    param([string]$CloudflaredPath)

    if (-not (Test-Path -LiteralPath $TunnelConfig)) {
        throw "Tunnel config not found at $TunnelConfig"
    }

    $existing = Get-CimInstance Win32_Process -Filter "name = 'cloudflared.exe'" |
        Where-Object { $_.CommandLine -like "*kpi-agent-cloudflared.yml*" -or $_.CommandLine -like "*run $TunnelName*" } |
        Select-Object -First 1

    if (-not $existing) {
        if (Test-Path -LiteralPath $TunnelLog) { Remove-Item -LiteralPath $TunnelLog -Force }
        $args = "tunnel --protocol http2 --config `"$TunnelConfig`" --logfile `"$TunnelLog`" --loglevel info run $TunnelName"
        Start-Process -FilePath $CloudflaredPath -ArgumentList $args -WorkingDirectory $Workspace -WindowStyle Hidden | Out-Null
        Start-Sleep -Seconds 5
    }

    $running = Get-CimInstance Win32_Process -Filter "name = 'cloudflared.exe'" |
        Where-Object { $_.CommandLine -like "*kpi-agent-cloudflared.yml*" -or $_.CommandLine -like "*run $TunnelName*" } |
        Select-Object -First 1
    if (-not $running) {
        $tail = if (Test-Path -LiteralPath $TunnelLog) { Get-Content -LiteralPath $TunnelLog -Tail 30 -ErrorAction SilentlyContinue } else { "" }
        throw "cloudflared tunnel did not stay running. $tail"
    }

    for ($i = 0; $i -lt 20; $i++) {
        try {
            Invoke-RestMethod -Uri "$PublicBase/health" -Method Get -TimeoutSec 10 | Out-Null
            Set-Content -LiteralPath $TunnelUrlPath -Value $PublicBase -Encoding UTF8
            return $PublicBase
        } catch {
            Start-Sleep -Seconds 3
        }
    }

    throw "Tunnel is running, but $PublicBase/health did not become reachable yet."
}

if (-not (Test-Path -LiteralPath $Node)) {
    throw "Node not found at $Node"
}

$cloudflared = Find-Cloudflared
if (-not $cloudflared) {
    throw "cloudflared not found. Install it with: winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements"
}

Ensure-Gateway
$url = Start-Tunnel -CloudflaredPath $cloudflared
$gatewayKey = (Get-Content -LiteralPath $GatewayKeyPath -Raw).Trim()

[pscustomobject]@{
    local_gateway = "$GatewayUrl/kpi/chat"
    public_gateway = "$url/kpi/chat"
    tunnel_base = $url
    gateway_key_file = $GatewayKeyPath
    gateway_key_prefix = $gatewayKey.Substring(0, [Math]::Min(12, $gatewayKey.Length)) + "..."
} | ConvertTo-Json -Depth 4
