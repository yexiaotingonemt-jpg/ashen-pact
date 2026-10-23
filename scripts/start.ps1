$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'dist\index.html'))) {
    Write-Host '请先安装 Node.js，然后在游戏目录执行 npm install 和 npm run build。'
    Read-Host '按回车退出'
    exit 1
}
$taskNode = (Get-Command node -ErrorAction Stop).Source
try {
    $taskResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:5183' -UseBasicParsing -TimeoutSec 2
    if ($taskResponse.Content -notmatch 'Ashen Pact') { throw 'Port 5183 is used by another app.' }
} catch {
    Start-Process -FilePath $taskNode -ArgumentList 'scripts/serve.mjs' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'server.log') -RedirectStandardError (Join-Path $taskRoot 'server-error.log')
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
        Start-Sleep -Milliseconds 250
        try { $taskResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:5183' -UseBasicParsing -TimeoutSec 1; if ($taskResponse.Content -match 'Ashen Pact') { $taskReady = $true; break } } catch {}
    }
    if (-not $taskReady) { throw '游戏未能启动，请检查 server-error.log 或端口 5183。' }
}
Start-Process 'http://127.0.0.1:5183'
