param(
    [string]$SshUser,
    [string]$RemoteHost = "www.yhaox.top",
    [int]$RemotePort = 18092,
    [int]$LocalPort = 8787
)

$ErrorActionPreference = "Stop"

$Workspace = "E:\PUAsimulator"
$Node = "E:\nodejs\node.exe"
$GatewayScript = Join-Path $Workspace "kpi-agent-gateway.js"
$GatewayUrl = "http://127.0.0.1:$LocalPort"
$KeyPath = Join-Path $Workspace "kpi-relay_ed25519"
$SshPath = "C:\Windows\System32\OpenSSH\ssh.exe"
$RelayLog = Join-Path $Workspace "kpi-ssh-relay.log"

if (-not $SshUser) {
    throw "SshUser is required, for example: .\start-kpi-ssh-relay.ps1 -SshUser root"
}
if (-not (Test-Path -LiteralPath $Node)) { throw "Node not found at $Node" }
if (-not (Test-Path -LiteralPath $GatewayScript)) { throw "Gateway script not found at $GatewayScript" }
if (-not (Test-Path -LiteralPath $KeyPath)) { throw "Relay key not found at $KeyPath" }
if (-not (Test-Path -LiteralPath $SshPath)) { throw "OpenSSH not found at $SshPath" }

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

function Stop-Cloudflared {
    $cloudflared = Get-CimInstance Win32_Process -Filter "name = 'cloudflared.exe'" |
        Where-Object {
            $_.CommandLine -like "*kpi-agent-cloudflared.yml*" -or
            $_.CommandLine -like "*run kpi-agent*"
        }
    foreach ($process in $cloudflared) {
        Stop-Process -Id $process.ProcessId -Force
    }
}

function Stop-ExistingRelay {
    $relay = Get-CimInstance Win32_Process -Filter "name = 'ssh.exe'" |
        Where-Object {
            $_.CommandLine -like "*$RemoteHost*" -and
            $_.CommandLine -like "*$RemotePort*" -and
            $_.CommandLine -like "*127.0.0.1:$LocalPort*"
        }
    foreach ($process in $relay) {
        Stop-Process -Id $process.ProcessId -Force
    }
}

Ensure-Gateway
Stop-Cloudflared
Stop-ExistingRelay
if (Test-Path -LiteralPath $RelayLog) { Remove-Item -LiteralPath $RelayLog -Force }

$remoteForward = "0.0.0.0:${RemotePort}:127.0.0.1:${LocalPort}"
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
        $_.CommandLine -like "*127.0.0.1:$LocalPort*"
    } |
    Select-Object -First 1
if (-not $running) {
    throw "SSH relay did not stay running. Check server SSH auth, GatewayPorts, and firewall."
}

$publicBase = "http://${RemoteHost}:${RemotePort}"
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
    local_gateway = "$GatewayUrl/kpi-create/chat"
    public_create = "$publicBase/kpi-create/chat"
    public_fix = "$publicBase/kpi-fix/chat"
    public_health = "$publicBase/health"
    relay_log = $RelayLog
} | ConvertTo-Json -Depth 4
