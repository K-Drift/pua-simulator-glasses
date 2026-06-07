param(
    [string]$RemoteHost = "www.yhaox.top",
    [int]$RemotePort = 18092,
    [int]$LocalPort = 8787,
    [switch]$StopGateway
)

$ErrorActionPreference = "Stop"

$ssh = Get-CimInstance Win32_Process -Filter "name = 'ssh.exe'" |
    Where-Object {
        $_.CommandLine -like "*$RemoteHost*" -and
        $_.CommandLine -like "*$RemotePort*" -and
        $_.CommandLine -like "*127.0.0.1:$LocalPort*"
    }
foreach ($process in $ssh) {
    Stop-Process -Id $process.ProcessId -Force
}

$gateway = @()
if ($StopGateway) {
    $gateway = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
        Where-Object { $_.CommandLine -like "*kpi-agent-gateway.js*" }
    foreach ($process in $gateway) {
        Stop-Process -Id $process.ProcessId -Force
    }
}

[pscustomobject]@{
    stopped_ssh_relay = @($ssh).Count
    stopped_gateway = @($gateway).Count
} | ConvertTo-Json -Depth 4
