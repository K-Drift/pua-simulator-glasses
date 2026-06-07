$ErrorActionPreference = "Stop"

$GatewayUrl = "http://127.0.0.1:8787"

$cloudflared = Get-CimInstance Win32_Process -Filter "name = 'cloudflared.exe'" |
    Where-Object {
        $_.CommandLine -like "*kpi-agent-cloudflared.yml*" -or
        $_.CommandLine -like "*run kpi-agent*" -or
        ($_.CommandLine -like "*tunnel*" -and $_.CommandLine -like "*$GatewayUrl*")
    }
foreach ($process in $cloudflared) {
    Stop-Process -Id $process.ProcessId -Force
}

$node = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*kpi-agent-gateway.js*" }
foreach ($process in $node) {
    Stop-Process -Id $process.ProcessId -Force
}

[pscustomobject]@{
    stopped_cloudflared = @($cloudflared).Count
    stopped_gateway = @($node).Count
} | ConvertTo-Json
