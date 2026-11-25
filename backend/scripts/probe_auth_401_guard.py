"""验证登录态保护：伪 401（瞬时故障模拟）不踢人、真 401（凭据失效）才踢人。

场景 1：mock unread-count 持续 401（模拟上游/瞬时伪 401）→ reload 触发真实 axios 轮询
        → 拦截器复核 /api/auth/me（真实成功）→ 重放原请求 → 仍 401（mock 持续）→
        _retried401 防循环 → 调用方兜底 → 用户保持登录态 + 诊断留痕。
场景 2：垃圾 token（真实 401）→ 复核 me 也 401 → 确认失效 → 跳 /login?expired=1。
        注意：不用 add_init_script（每次导航都会重写 token，污染断言），
        改为 about:blank 中 evaluate 一次性写入。
"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, ".")

from sqlalchemy import text

from database.database import SessionLocal
from services.auth_service import create_access_token

db = SessionLocal()
try:
    row = db.execute(text(
        "SELECT id, username, tenant_id FROM users "
        "WHERE role_id=(SELECT id FROM roles WHERE code='admin' AND deleted_at IS NULL LIMIT 1) "
        "AND deleted_at IS NULL LIMIT 1"
    )).fetchone()
finally:
    db.close()

BASE = "http://127.0.0.1:8002"
token = create_access_token(data={"sub": row[1], "uid": row[0], "tid": row[2]})

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)

    # ===== 场景 1：伪 401 → 不踢人 =====
    ctx = b.new_context(viewport={"width": 1600, "height": 900})
    ctx.add_init_script(f"window.localStorage.setItem('token', {token!r});")
    page = ctx.new_page()
    page.goto(f"{BASE}/inventory", wait_until="networkidle", timeout=60000)
    page.wait_for_selector(".ant-table-tbody tr.ant-table-row", timeout=40000)

    # mock：unread-count 持续返回 401（模拟瞬时伪 401 / 上游误判）
    page.route("**/api/notifications/unread-count*", lambda route: route.fulfill(
        status=401, content_type="application/json",
        body='{"detail":"mocked-401"}'))
    # reload → MainLayout 挂载即调 fetchUnreadCount（真实 axios，走拦截器）
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(3000)  # 等拦截器复核 + 重放完成
    path1 = page.evaluate("() => window.location.pathname")
    token_kept = page.evaluate("() => !!localStorage.getItem('token')")
    log1 = page.evaluate("() => JSON.parse(localStorage.getItem('auth_401_log') || '[]')")
    print(f"[场景1 伪401] 路径={path1} token保留={token_kept}")
    print(f"[场景1 伪401] 诊断日志={log1}")
    assert path1 == "/inventory", f"FAIL: 伪 401 竟然踢出了用户，当前在 {path1}"
    assert token_kept, "FAIL: token 被清除"
    assert any(e.get("phase") == "recheck-pass" for e in log1), \
        f"FAIL: 复核通过未被记录（拦截器复核逻辑未生效）: {log1}"
    print("[场景1] PASS —— 伪 401 复核通过、静默重放、用户保持登录态")
    ctx.close()

    # ===== 场景 2：真 401（垃圾 token）→ 踢人到登录页 =====
    ctx2 = b.new_context(viewport={"width": 1600, "height": 900})
    page2 = ctx2.new_page()
    # 先到同源 /login 写入垃圾 token（无 token 也能停留；evaluate 一次性写入）
    page2.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=60000)
    page2.evaluate("() => localStorage.setItem('token', 'garbage-token-xx')")
    page2.goto(f"{BASE}/inventory", wait_until="domcontentloaded", timeout=60000)
    # 等待跳转登录页（复核确认 → assign）
    page2.wait_for_url("**/login**", timeout=20000)
    page2.wait_for_timeout(1500)
    # 注意：assign 前拦截器已 removeItem；Login 页 AuthContext 初始化读到 null 才是断言依据
    token2 = page2.evaluate("() => localStorage.getItem('token')")
    log2 = page2.evaluate("() => JSON.parse(localStorage.getItem('auth_401_log') || '[]')")
    print(f"[场景2 真401] 路径={page2.url} token={token2!r}")
    print(f"[场景2 真401] 诊断日志={log2}")
    assert "/login" in page2.url, f"FAIL: 真 401 未跳登录页，当前 {page2.url}"
    assert token2 in (None, ""), f"FAIL: 真 401 后 token 未清除: {token2!r}"
    assert any(e.get("phase") == "recheck-failed" and e.get("recheckStatus") == 401 for e in log2), \
        f"FAIL: 复核失败未被记录: {log2}"
    print("[场景2] PASS —— 真凭据失效经复核确认后踢到登录页，token 已清除")
    ctx2.close()
    b.close()

print("\n=== 登录态保护验证全部通过 ===")
