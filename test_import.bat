@echo off
echo === 1. 登录获取Token ===
curl -s -X POST "http://115.190.250.14:8002/api/auth/login" -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"你的密码\"}"
echo.
echo.
echo === 2. 上传文件触发导入 ===
curl -s -X POST "http://115.190.250.14:8002/api/restock/import" -F "file=@C:\data\库存补货.xlsx"
echo.
echo.
echo === 3. 查询导入状态 ===
curl -s -X GET "http://115.190.250.14:8002/api/restock/import-status" -H "Authorization: Bearer 上一步登录返回的access_token"
echo.
pause
