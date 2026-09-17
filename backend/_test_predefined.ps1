$token = (python c:\Users\Administrator\Desktop\AI\AIBXHS\backend\_gen_token.py) | Out-String
$token = $token.Trim()
Write-Host "Token length: $($token.Length)"
$headers = @{ Authorization = "Bearer $token" }
$base = "http://localhost:8002"

Write-Host "`n=== 1. GET /api/ad-rules/predefined ==="
try {
    $r1 = Invoke-RestMethod -Uri "$base/api/ad-rules/predefined" -Method Get -Headers $headers -TimeoutSec 10
    Write-Host "success: $($r1.success)"
    Write-Host "规则数量: $($r1.data.Count)"
    $r1.data | Select-Object id, name, rule_type, priority, is_enabled | Format-Table
    Write-Host "`n第一条规则 conditions:"
    $r1.data[0].conditions | ConvertTo-Json
    Write-Host "`n第一条规则 actions:"
    $r1.data[0].actions | ConvertTo-Json
} catch {
    Write-Host "Failed: $($_.Exception.Message)"
    Write-Host $_.ErrorDetails.Message
}

Write-Host "`n=== 2. PUT /api/ad-rules/predefined/2 (disable acos_too_high) ==="
$body = @{ is_enabled = $false } | ConvertTo-Json
try {
    $r2 = Invoke-RestMethod -Uri "$base/api/ad-rules/predefined/2" -Method Put -Body $body -ContentType "application/json" -Headers $headers -TimeoutSec 5
    $r2 | ConvertTo-Json
} catch {
    Write-Host "Failed: $($_.Exception.Message)"
}

Write-Host "`n=== 3. GET /api/ad-rules/predefined (验证 rule 2 已禁用) ==="
try {
    $r3 = Invoke-RestMethod -Uri "$base/api/ad-rules/predefined" -Method Get -Headers $headers -TimeoutSec 5
    $rule2 = $r3.data | Where-Object { $_.id -eq 2 }
    Write-Host "rule 2 is_enabled: $($rule2.is_enabled)"
} catch {
    Write-Host "Failed: $($_.Exception.Message)"
}

Write-Host "`n=== 4. PUT /api/ad-rules/predefined/2 (恢复启用) ==="
$body2 = @{ is_enabled = $true } | ConvertTo-Json
try {
    $r4 = Invoke-RestMethod -Uri "$base/api/ad-rules/predefined/2" -Method Put -Body $body2 -ContentType "application/json" -Headers $headers -TimeoutSec 5
    Write-Host "Restored: $($r4.success)"
} catch {
    Write-Host "Failed: $($_.Exception.Message)"
}

Write-Host "`n=== 5. PUT /api/ad-rules/predefined/2 (修改阈值) ==="
$body3 = @{ conditions = @(
    @{ metric = "acos"; operator = ">"; threshold = 0.35; unit = "%" }
    @{ metric = "spend"; operator = ">="; threshold = 15.0; unit = "$" }
) } | ConvertTo-Json -Depth 5
try {
    $r5 = Invoke-RestMethod -Uri "$base/api/ad-rules/predefined/2" -Method Put -Body $body3 -ContentType "application/json" -Headers $headers -TimeoutSec 5
    $r5 | ConvertTo-Json
} catch {
    Write-Host "Failed: $($_.Exception.Message)"
}

Write-Host "`n=== 6. GET /api/ad-rules/predefined (验证阈值已更新) ==="
try {
    $r6 = Invoke-RestMethod -Uri "$base/api/ad-rules/predefined" -Method Get -Headers $headers -TimeoutSec 5
    $rule2b = $r6.data | Where-Object { $_.id -eq 2 }
    Write-Host "rule 2 conditions after update:"
    $rule2b.conditions | ConvertTo-Json
} catch {
    Write-Host "Failed: $($_.Exception.Message)"
}

Write-Host "`n=== 7. PUT /api/ad-rules/predefined/99 (invalid id, expect 404) ==="
$bodyBad = @{ is_enabled = $true } | ConvertTo-Json
try {
    $r7 = Invoke-RestMethod -Uri "$base/api/ad-rules/predefined/99" -Method Put -Body $bodyBad -ContentType "application/json" -Headers $headers -TimeoutSec 5
    Write-Host "Unexpected success: $($r7 | ConvertTo-Json)"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host "Expected failure. HTTP $code"
}
