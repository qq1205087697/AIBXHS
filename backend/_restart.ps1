$port = 8002
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    foreach ($c in $conns) {
        $procId = $c.OwningProcess
        Write-Host "Stopping PID=$procId listening on $port"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    Write-Host "Old process stopped."
} else {
    Write-Host "No listener on $port"
}

Write-Host "Starting backend on $port..."
Start-Process -FilePath "python" -ArgumentList "main.py" -WorkingDirectory "c:\Users\Administrator\Desktop\AI\AIBXHS\backend" -WindowStyle Hidden
Start-Sleep -Seconds 6
$health = (Invoke-WebRequest -Uri "http://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 5).StatusCode
Write-Host "Health check status: $health"
