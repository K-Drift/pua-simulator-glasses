param(
    [string]$SshUser = "Administrator",
    [string]$RemoteHost = "www.yhaox.top",
    [int]$RemotePort = 18093,
    [int]$LocalHttpsPort = 8788,
    [int]$LocalGatewayPort = 8787
)

$ErrorActionPreference = "Stop"

$Workspace = "E:\PUAsimulator"
$Node = "E:\nodejs\node.exe"
$GatewayScript = Join-Path $Workspace "kpi-agent-gateway.js"
$HttpsProxyScript = Join-Path $Workspace "kpi-https-proxy.js"
$KeyPath = Join-Path $Workspace "kpi-relay_ed25519"
$SshPath = "C:\Windows\System32\OpenSSH\ssh.exe"
$RelayLog = Join-Path $Workspace "kpi-https-ssh-relay.log"
$ProxyLog = Join-Path $Workspace "kpi-https-proxy.log"
$ProxyErrorLog = Join-Path $Workspace "kpi-https-proxy.err.log"
$GatewayUrl = "http://127.0.0.1:$LocalGatewayPort"
$LocalHttpsUrl = "https://127.0.0.1:$LocalHttpsPort"

if (-not (Test-Path -LiteralPath $Node)) { throw "Node not found at $Node" }
if (-not (Test-Path -LiteralPath $GatewayScript)) { throw "Gateway script not found at $GatewayScript" }
if (-not (Test-Path -LiteralPath $HttpsProxyScript)) { throw "HTTPS proxy script not found at $HttpsProxyScript" }
if (-not (Test-Path -LiteralPath $KeyPath)) { throw "Relay key not found at $KeyPath" }
if (-not (Test-Path -LiteralPath $SshPath)) { throw "OpenSSH not found at $SshPath" }

function Stop-MatchingProcess {
    param([string]$Name, [scriptblock]$Filter)

    $processes = Get-CimInstance Win32_Process -Filter "name = '$Name'" | Where-Object $Filter
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force
        Wait-Process -Id $process.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
    }
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

function Ensure-HttpsProxy {
    Stop-MatchingProcess -Name "node.exe" -Filter {
        $_.CommandLine -like "*kpi-https-proxy.js*" -or
        $_.CommandLine -like "*KPI_HTTPS_PORT=$LocalHttpsPort*"
    }

    if (Test-Path -LiteralPath $ProxyLog) { Remove-Item -LiteralPath $ProxyLog -Force }
    if (Test-Path -LiteralPath $ProxyErrorLog) { Remove-Item -LiteralPath $ProxyErrorLog -Force }

    $env:KPI_HTTPS_PORT = "$LocalHttpsPort"
    $env:KPI_GATEWAY_PORT = "$LocalGatewayPort"
    Start-Process -FilePath $Node -ArgumentList "`"$HttpsProxyScript`"" -WorkingDirectory $Workspace -RedirectStandardOutput $ProxyLog -RedirectStandardError $ProxyErrorLog -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 2

    & curl.exe -k -fsS "$LocalHttpsUrl/health" | Out-Null
}

function Stop-ExistingRelay {
    Stop-MatchingProcess -Name "ssh.exe" -Filter {
        $_.CommandLine -like "*$RemoteHost*" -and
        $_.CommandLine -like "*$RemotePort*" -and
        $_.CommandLine -like "*127.0.0.1:$LocalHttpsPort*"
    }
}

Ensure-Gateway
Ensure-HttpsProxy
Stop-ExistingRelay
if (Test-Path -LiteralPath $RelayLog) { Remove-Item -LiteralPath $RelayLog -Force }

$remoteForward = "0.0.0.0:${RemotePort}:127.0.0.1:${LocalHttpsPort}"
$target = "${SshUser}@${RemoteHost}"
$sshArgs = @(
    "-N",
    "-T",
    "-E", "`"$RelayLog`"",
    "-i", "`"$KeyPath`"",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "StrictHostKeyChecking=accept-new",
    "-R", $remoteForward,
    $target
)

Start-Process -FilePath $SshPath -ArgumentList $sshArgs -WorkingDirectory $Workspace -WindowStyle Hidden | Out-Null
Start-Sleep -Seconds 4

$running = Get-CimInstance Win32_Process -Filter "name = 'ssh.exe'" |
    Where-Object {
        $_.CommandLine -like "*$RemoteHost*" -and
        $_.CommandLine -like "*$RemotePort*" -and
        $_.CommandLine -like "*127.0.0.1:$LocalHttpsPort*"
    } |
    Select-Object -First 1
if (-not $running) {
    throw "HTTPS SSH relay did not stay running. Check server SSH auth, GatewayPorts, and remote firewall."
}

$publicBase = "https://${RemoteHost}:${RemotePort}"
$healthOk = $false
for ($i = 0; $i -lt 10; $i++) {
    try {
        Invoke-RestMethod -Uri "$publicBase/health" -Method Get -TimeoutSec 10 | Out-Null
        $healthOk = $true
        break
    } catch {
        Start-Sleep -Seconds 2
    }
}

[pscustomobject]@{
    ok = $healthOk
    relay_process_id = $running.ProcessId
    local_https_proxy = "$LocalHttpsUrl/health"
    public_health = "$publicBase/health"
    public_create = "$publicBase/voicechat/kpi-create"
    public_fix = "$publicBase/voicechat/kpi-fix"
    relay_log = $RelayLog
    proxy_log = $ProxyLog
    proxy_error_log = $ProxyErrorLog
} | ConvertTo-Json -Depth 4
