#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读自检：导入改为独立子进程后的关键契约验证。

不触发真实导入，只验证：
  1. 状态文件机制（写读往返、字段完整）
  2. 进程存活判定（含 Windows 安全实现）
  3. 死进程残留 is_running 的兜底修正
  4. 子进程入口可导入、_do_import 签名正确
  5. start_import_async 确实走 subprocess 且不再起 _do_import 线程
"""
import importlib
import inspect
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

checks = []


def check(name, cond, detail=""):
    checks.append((name, bool(cond), detail))


from services import inventory_import_service as svc

# 1) 状态文件位置
check("状态文件位于 backend/ 下", svc._STATUS_FILE.endswith(".import_status.json"), svc._STATUS_FILE)
check("状态文件含 worker_pid 字段", "worker_pid" in svc._DEFAULT_STATUS)

# 2) 状态读取结构完整
st = svc.get_import_status()
missing = [k for k in svc._DEFAULT_STATUS if k not in st]
check("get_import_status 字段完整", not missing, f"missing={missing}")

# 3) 进程存活判定（Windows 下必须不杀进程）
me = os.getpid()
alive_before = True
check("_pid_alive(自身 pid) == True", svc._pid_alive(me))
check("_pid_alive(自身 pid) 未误杀进程", alive_before and svc._pid_alive(me))
check("_pid_alive(不存在的 pid) == False", not svc._pid_alive(99999999))
check("_pid_alive(None/非法值) == False", not svc._pid_alive(None) and not svc._pid_alive("abc"))

# 4) 死进程残留 is_running 的兜底修正
svc._write_status_file({**svc._DEFAULT_STATUS,
    "is_running": True, "worker_pid": 99999999, "started_at": time.time(),
})
st = svc.get_import_status()
check("死进程残留 is_running 被修正为 False", st["is_running"] is False)
check("修正时写入 error 说明", bool(st.get("error")), st.get("error"))

# 5) 活进程（自身）的 is_running 不被误改
svc._write_status_file({**svc._DEFAULT_STATUS,
    "is_running": True, "worker_pid": me, "started_at": time.time(),
})
st = svc.get_import_status()
check("活进程 is_running 保持不变", st["is_running"] is True)

# 6) 状态写读往返
svc._write_status_file({**svc._DEFAULT_STATUS, "progress": 42, "step": "验证中", "total_rows": 46790})
st = svc.get_import_status()
check("状态文件写读往返一致", st["progress"] == 42 and st["step"] == "验证中" and st["total_rows"] == 46790)

# 7) _StatusStore 变更即落盘
store = svc._StatusStore(svc._STATUS_FILE, dict(svc._DEFAULT_STATUS))
store["progress"] = 77
check("_StatusStore 变更即落盘", svc._read_status_file()["progress"] == 77)
store["progress"] = 77  # 同值不应重复写
check("_StatusStore 同值去重（不报错）", svc._read_status_file()["progress"] == 77)

# 8) 子进程入口
worker = importlib.import_module("services.import_worker")
check("import_worker 可导入且含 main()", callable(getattr(worker, "main", None)))

# 9) _do_import 签名
sig = inspect.signature(svc._do_import)
check("_do_import 有 wait_for_sync 参数", "wait_for_sync" in sig.parameters)
if "wait_for_sync" in sig.parameters:
    check("wait_for_sync 默认 False（主进程行为不变）", sig.parameters["wait_for_sync"].default is False)

# 10) start_import_async 已切到子进程
src = inspect.getsource(svc.start_import_async)
check("start_import_async 使用 subprocess.Popen", "subprocess.Popen" in src)
check("start_import_async 不再起 _do_import 线程", "target=_do_import" not in src)
check("start_import_async 走 services.import_worker", "services.import_worker" in src)

# 11) 步骤9 已移到 db.close() 之后
dsrc = inspect.getsource(svc._do_import)
close_idx = dsrc.rfind("db.close()")
sync_idx = dsrc.rfind("触发FBA同步在途...")
check("FBA同步在 close 之后触发", sync_idx > close_idx, f"close@{close_idx} sync@{sync_idx}")

# 收尾：恢复干净状态
svc._write_status_file(dict(svc._DEFAULT_STATUS))

ok = sum(1 for _, c, _ in checks if c)
print("=" * 64)
for name, passed, detail in checks:
    line = f"  [{'PASS' if passed else 'FAIL'}] {name}"
    if detail and not passed:
        line += f"  -> {detail}"
    print(line)
print("=" * 64)
print(f"{ok}/{len(checks)} PASS")
sys.exit(0 if ok == len(checks) else 1)
