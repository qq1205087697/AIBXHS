import requests

BASE = "http://localhost:8002/api"

# 使用OAuth2表单登录
from requests.auth import HTTPBasicAuth
# 先看看登录接口需要什么格式
# 尝试form格式
r = requests.post(f"{BASE}/auth/login", json={"username": "k", "password": "123456"})
print(f"JSON login: {r.status_code}")
if r.status_code == 200:
    token = r.json().get("access_token")
    headers = {"Authorization": f"Bearer {token}"}

    r1 = requests.get(f"{BASE}/product-page-info/", headers=headers, params={"page": 1, "page_size": 5})
    print(f"All: {r1.status_code} total={r1.json().get('total')}")

    r2 = requests.get(f"{BASE}/product-page-info/", headers=headers, params={"page": 1, "page_size": 5, "rating_status": 1})
    print(f"Rated: {r2.status_code} total={r2.json().get('total')}")

    r3 = requests.get(f"{BASE}/product-page-info/", headers=headers, params={"page": 1, "page_size": 5, "rating_status": 0})
    print(f"Unrated: {r3.status_code} total={r3.json().get('total')}")
else:
    print(f"Login failed: {r.text[:200]}")
    # 尝试data格式
    r = requests.post(f"{BASE}/auth/login", data={"username": "k", "password": "123456"})
    print(f"Form login: {r.status_code} {r.text[:200]}")
