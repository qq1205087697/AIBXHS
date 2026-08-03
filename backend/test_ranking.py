import requests

# 登录
r = requests.post("http://localhost:8002/api/auth/login", json={"username": "k", "password": "k123456"})
print(f"Login: {r.status_code}")
if r.status_code != 200:
    r = requests.post("http://localhost:8002/api/auth/login", data={"username": "k", "password": "k123456"})
    print(f"Form Login: {r.status_code}")
if r.status_code == 200:
    token = r.json().get("access_token")
    headers = {"Authorization": f"Bearer {token}"}
    r2 = requests.get("http://localhost:8002/api/product-page-info/ranking", headers=headers)
    print(f"Ranking: {r2.status_code}")
    data = r2.json()
    top10 = data.get("data", {}).get("top10", [])
    bottom10 = data.get("data", {}).get("bottom10", [])
    print(f"Top10 count: {len(top10)}, Bottom10 count: {len(bottom10)}")
    if top10:
        print(f"First top: {top10[0]}")
    if bottom10:
        print(f"First bottom: {bottom10[0]}")
else:
    print(f"Login failed: {r.text[:200]}")
