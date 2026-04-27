# scripts/opencode-proxy.ps1
# 先设置代理，再启动 opencode（只影响本进程，不污染系统）

$proxy = "http://127.0.0.1:7897"   # 改成你的端口

$env:HTTPS_PROXY = $proxy
$env:HTTP_PROXY  = $proxy
$env:NO_PROXY    = "localhost,127.0.0.1,::1"
$env:ALL_PROXY   = $null

Write-Host "Using proxy: $proxy"
opencode
