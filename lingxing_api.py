# -*- coding: utf-8 -*-
"""
领星开放平台 API 客户端封装 —— 凭证加载 / 认证 / 签名 / 店铺与 Listing 查询

完整调用链路：
  1. 从 .env 读取凭证（LINGXING_APP_ID / LINGXING_APP_SECRET）
  2. 调 /api/auth-server/oauth/access-token 换取 access_token（带本地缓存，过期自动重取）
  3. 调 /erp/sc/data/seller/lists 获取授权的全部亚马逊店铺（sid）
  4. 调 /erp/sc/data/mws/listing 分页查询 Listing（搜索 sid 全店）

签名规则（领星开放平台标准）：
  - 业务参数 + access_token + app_key + timestamp，按参数名 ASCII 升序拼接成 query string
  - 先算 MD5（32位小写）再转大写，得到待加密字符串
  - 以 appId 作为密钥，AES/ECB/PKCS5Padding 加密后 base64 编码，得到 sign（自动 URL 编码）

注意：凭证不在本文件中，统一放在 backend/.env（已加入 .gitignore，不入库）。
"""
import hashlib
import json
import os
import time
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlencode

import requests
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

# ----------------------------------------------------------------------------- #
# 配置区：从 .env 读取凭证（LINGXING_APP_ID / LINGXING_APP_SECRET），代码中不出现任何敏感数据
# ----------------------------------------------------------------------------- #
BASE_URL = "https://openapi.lingxing.com"          # 开放平台统一网关（旧域名 api.lingxing.com 已停用）
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# .env 查找顺序：环境变量 > backend/.env > 项目根 .env（与后端 config.py 的加载顺序一致）
_ENV_CANDIDATES = [
    os.path.join(_SCRIPT_DIR, "backend", ".env"),
    os.path.join(_SCRIPT_DIR, ".env"),
]
TOKEN_CACHE_FILE = os.path.join(_SCRIPT_DIR, ".lingxing_token.json")


def _load_config() -> Dict[str, str]:
    """从 .env 读取领星开放平台凭证，返回 {"app_id": ..., "app_secret": ...}

    - 优先读环境变量 LINGXING_APP_ID / LINGXING_APP_SECRET（便于部署时覆盖）
    - 否则按 _ENV_CANDIDATES 顺序取第一个存在的 .env，解析 KEY=VALUE 行
      （支持 # 注释、空行，值可带引号）
    - 凭证缺失或为空时抛错，提示用户补齐
    """
    app_id = os.getenv("LINGXING_APP_ID", "").strip()
    app_secret = os.getenv("LINGXING_APP_SECRET", "").strip()

    if not app_id or not app_secret:
        for env_path in _ENV_CANDIDATES:
            if not os.path.exists(env_path):
                continue
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue                    # 跳过注释、空行、无效行
                    key, _, value = line.partition("=")
                    key, value = key.strip(), value.strip().strip("'\"")
                    if key == "LINGXING_APP_ID" and not app_id:
                        app_id = value
                    elif key == "LINGXING_APP_SECRET" and not app_secret:
                        app_secret = value
            if app_id and app_secret:
                break

    if not app_id or not app_secret:
        raise RuntimeError(
            "未找到领星凭证，请在 backend/.env 中配置：\n"
            "  LINGXING_APP_ID=你的AppID\n"
            "  LINGXING_APP_SECRET=你的AppSecret"
        )
    return {"app_id": app_id, "app_secret": app_secret}


_CONFIG = _load_config()
APP_ID = _CONFIG["app_id"]                          # 开放平台应用 App ID（appId，同时用作 AES 签名密钥）
APP_SECRET = _CONFIG["app_secret"]                  # 开放平台应用 App Secret（appSecret）


# ----------------------------------------------------------------------------- #
# 认证：获取并缓存 access_token
# ----------------------------------------------------------------------------- #
def get_access_token(force_refresh: bool = False) -> str:
    """获取 access_token；本地缓存到 .lingxing_token.json，过期前自动重新获取。

    POST /api/auth-server/oauth/access-token
      - Content-Type: application/x-www-form-urlencoded
      - 参数: appId / appSecret（此接口无需签名）
      - 返回: {"code": 200, "data": {"access_token": "...", "expires_in": ...}}
    """
    # 1. 读取缓存：token 未过期（留 60 秒余量）则直接复用
    if not force_refresh and os.path.exists(TOKEN_CACHE_FILE):
        try:
            with open(TOKEN_CACHE_FILE, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if cached.get("access_token") and time.time() < cached.get("expires_at", 0) - 60:
                return cached["access_token"]
        except (json.JSONDecodeError, OSError):
            pass  # 缓存损坏则走重新获取

    # 2. 调领星认证接口换取新 token
    resp = requests.post(
        f"{BASE_URL}/api/auth-server/oauth/access-token",
        data={"appId": APP_ID, "appSecret": APP_SECRET},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    # 领星认证接口返回的 code 可能是字符串 '200'，统一按字符串比较
    if str(body.get("code")) != "200":
        raise RuntimeError(f"获取 access_token 失败: {body}")
    data = body["data"]

    # 3. 写入缓存（expires_at = 当前时间 + 有效期）
    token = data["access_token"]
    with open(TOKEN_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump({"access_token": token,
                   "expires_at": time.time() + int(data.get("expires_in", 7200))}, f)
    return token


# ----------------------------------------------------------------------------- #
# 签名与公共请求封装
# ----------------------------------------------------------------------------- #
def make_sign(params: Dict[str, Any], access_token: Optional[str] = None) -> str:
    """按领星规则生成 sign 参数。

    两种调用方式：
      - make_sign(params, token)：params 为业务参数，函数内部自动合并 access_token/app_key/timestamp
      - make_sign(params)：params 已包含 access_token/app_key/timestamp，直接参与排序拼接

    步骤：
      1. 把业务参数与 access_token/app_key/timestamp 合并（数组型参数转逗号字符串）
      2. 按参数名 ASCII 升序拼接成 k1=v1&k2=v2&...（不排序的顺序结果无效）
      3. MD5(32位小写) 后转大写，得到待加密字符串
      4. 以 appId 为密钥 AES/ECB/PKCS5Padding 加密，base64 编码即为 sign
    """
    # 步骤 1：合并公共参数（timestamp 必须秒级；单参数调用时视为已含公共参数）
    merged = {k: (",".join(v) if isinstance(v, (list, tuple)) else v) for k, v in params.items()}
    if access_token is not None:
        merged.update({"access_token": access_token, "app_key": APP_ID, "timestamp": str(int(time.time()))})

    # 步骤 2：参数名 ASCII 升序拼接
    sorted_str = "&".join(
        f"{k}={merged[k]}" for k in sorted(merged.keys(), key=lambda s: s.encode())
    )

    # 步骤 3：MD5 后转大写
    plain = hashlib.md5(sorted_str.encode("utf-8")).hexdigest().upper()

    # 步骤 4：AES/ECB/PKCS7(等价于PKCS5) 加密 + base64
    cipher = AES.new(APP_ID.encode(), AES.MODE_ECB)
    encrypted = cipher.encrypt(pad(plain.encode("utf-8"), AES.block_size))
    import base64
    return base64.b64encode(encrypted).decode("utf-8")


def call_api(method: str, path: str, params: Dict[str, Any],
             expect_list: bool = False) -> Any:
    """统一请求入口：自动带签名与 Authorization 头，处理分页结果合并与限频。

    - method: "GET" 或 "POST"；POST 时业务参数放 JSON body
    - path:   如 /erp/sc/data/mws/listing
    - params: 业务参数（sign 等公共参数由本函数自动补齐）
    - expect_list: 部分接口（如 seller/lists）返回 data 本身就是数组，
                   而非 {"total":..,"list":..} 结构，置 True 以正确取值
    - 遇到限频(20002)/服务繁忙(101005)自动休眠重试；token 失效(10005)自动刷新重试一次
    """
    method = method.upper()

    def _request(token: str) -> requests.Response:
        # 每次请求重新生成 sign（timestamp 已变化）
        signed = dict(params)
        signed.update({"access_token": token, "app_key": APP_ID, "timestamp": str(int(time.time()))})
        # 签名用原始合并串生成，再作为普通参数传递（requests 会自动 URL 编码）
        sign = make_sign({k: v for k, v in signed.items() if k not in ("access_token", "app_key", "timestamp")}, token)
        signed["sign"] = sign
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        if method == "GET":
            return requests.get(f"{BASE_URL}{path}", params=signed, headers=headers, timeout=60)
        return requests.post(f"{BASE_URL}{path}", json=signed, headers=headers, timeout=60)

    token = get_access_token()
    for attempt in range(5):
        resp = _request(token)
        resp.raise_for_status()
        body = resp.json()

        # token 失效：强制刷新后重试一次
        if str(body.get("code")) == "10005":
            token = get_access_token(force_refresh=True)
            continue
        # 限频/服务繁忙：按提示休眠后重试
        if str(body.get("code")) in ("20002", "101005"):
            time.sleep(float(body.get("msg", "").split("_")[-1]) if str(body.get("msg", "")).endswith("s") else 2)
            continue
        # 领星响应兼容两种风格：新接口 code=200，旧接口 code=0（message=success）
        if str(body.get("code")) not in ("0", "200"):
            raise RuntimeError(f"API {path} 返回异常: {body}")

        data = body.get("data")
        # 分页接口：data 为 {"total":..,"list":[..]}，如有下一页则继续拉取合并
        if isinstance(data, dict) and isinstance(data.get("list"), list):
            all_rows: List[dict] = list(data["list"])
            offset, total, page_size = len(all_rows), data.get("total", 0), params.get("page_size") or 200
            while offset < total and len(all_rows) < 100000:
                nxt = dict(params)
                nxt["page_offset"] = offset
                nxt["page_size"] = page_size
                body2 = _request(token).json()
                if str(body2.get("code")) not in ("0", "200"):
                    raise RuntimeError(f"API {path} 分页返回异常: {body2}")
                all_rows.extend(body2["data"]["list"])
                offset = len(all_rows)
            return all_rows
        return data
    raise RuntimeError(f"API {path} 重试次数用尽")


# ----------------------------------------------------------------------------- #
# 业务接口封装
# ----------------------------------------------------------------------------- #
def get_amazon_sellers() -> List[dict]:
    """查询授权的全部亚马逊店铺（GET /erp/sc/data/seller/lists）。

    返回字段：sid（店铺ID）、seller_name（店铺名）、status（1=正常 2=授权异常）、country 等
    """
    return call_api("GET", "/erp/sc/data/seller/lists", {}, expect_list=True)


def get_listings(sids: Iterable[int], page_size: int = 200, extra: Optional[dict] = None) -> List[dict]:
    """查询亚马逊 Listing（POST /erp/sc/data/mws/listing），自动翻页合并全部结果。

    - sids: 店铺 ID 列表（逗号拼接传给 sid 参数）
    - page_size: 单页条数（上限 1000）
    - extra: 其他过滤参数，如 search_field/search_value、is_pair、is_delete 等
    返回字段示例：sid/seller_sku/asin/fnsku/price/stock_fba/last_star/last_review_num ...
    """
    params = {"sid": ",".join(str(s) for s in sids), "page_size": page_size}
    if extra:
        params.update(extra)
    return call_api("POST", "/erp/sc/data/mws/listing", params)


def main():
    """演示流程：取店铺列表 → 选第一个正常店铺 → 查询其 Listing 前 200 条并打印摘要"""
    # 1. 拉取全部授权店铺
    sellers = get_amazon_sellers()
    ok = [s for s in sellers if s.get("status") == 1]
    print(f"授权店铺共 {len(sellers)} 个，正常 {len(ok)} 个")

    # 2. 优先用第一个正常店铺演示（也可手动指定 sid）
    target = ok[0] if ok else sellers[0]
    print(f"示例店铺: sid={target['sid']} {target.get('seller_name')}")

    # 3. 查询该店铺 Listing
    rows = get_listings([target["sid"]], page_size=200)
    print(f"拉取 Listing {len(rows)} 条，字段示例: {list(rows[0].keys()) if rows else '无'}")
    for r in rows[:3]:
        print(f"  MSKU={r.get('seller_sku')} ASIN={r.get('asin')} 评分={r.get('last_star')} 价格={r.get('price')}{r.get('currency') or ''}")


if __name__ == "__main__":
    main()
