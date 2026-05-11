
import requests
import json

print("=== 开始测试导入 ===")
try:
    response = requests.post(
        "http://localhost:8002/api/restock/import",
        params={"file_path": "C:\\Users\\Administrator\\Desktop\\补货建议.xlsx"}
    )
    print(f"状态码: {response.status_code}")
    print(f"响应:")
    print(json.dumps(response.json(), ensure_ascii=False, indent=2))
except Exception as e:
    print(f"错误: {e}")
    import traceback
    print(traceback.format_exc())

