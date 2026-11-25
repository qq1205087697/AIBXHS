#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""端到端冒烟：验证导入确实跑在独立子进程，且主进程不承载数据。

默认模式（安全，不写数据库）：
    故意传非法 Excel，子进程在「读取Excel」即失败，但完整走通
    启动子进程 → 状态跨进程可见 → 错误状态落盘 → 子进程退出 → 临时文件清理

真实模式（会写数据库，需显式指定文件）：
    python scripts/smoke_subprocess_import.py --real "D:\\...\\结果.xlsx"
    额外测量：子进程峰值 RSS、子进程退出后是否消失、主进程 RSS 增量。
"""
import argparse
import ctypes
import ctypes.wintypes
import glob
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.inventory_import_service import (
    _pid_alive, get_import_status, start_import_async,
)

# ---------------------------------------------------------------- RSS 测量
class _PMC(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.wintypes.DWORD), ("PageFaultCount", ctypes.wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
    ]


_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
_psapi = ctypes.WinDLL("psapi", use_last_error=True)
_kernel32.GetCurrentProcess.restype = ctypes.wintypes.HANDLE
_kernel32.OpenProcess.restype = ctypes.wintypes.HANDLE
_kernel32.OpenProcess.argtypes = [ctypes.wintypes.DWORD, ctypes.wintypes.BOOL, ctypes.wintypes.DWORD]
_kernel32.CloseHandle.argtypes = [ctypes.wintypes.HANDLE]
_psapi.GetProcessMemoryInfo.argtypes = [ctypes.wintypes.HANDLE, ctypes.POINTER(_PMC), ctypes.wintypes.DWORD]
_psapi.GetProcessMemoryInfo.restype = ctypes.wintypes.BOOL

_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_PROCESS_VM_READ = 0x0010


def _read_pmc(handle):
    c = _PMC()
    c.cb = ctypes.sizeof(c)
    if not _psapi.GetProcessMemoryInfo(handle, ctypes.byref(c), c.cb):
        return None
    return c


def rss_mb(pid=None) -> float:
    """当前进程（pid=None）或指定进程的 WorkingSet（MB），失败返回 -1。"""
    if pid is None:
        c = _read_pmc(_kernel32.GetCurrentProcess())
        return c.WorkingSetSize / 1048576 if c else -1.0
    handle = _kernel32.OpenProcess(
        _PROCESS_QUERY_LIMITED_INFORMATION | _PROCESS_VM_READ, False, int(pid))
    if not handle:
        return -1.0
    try:
        c = _read_pmc(handle)
        return c.WorkingSetSize / 1048576 if c else -1.0
    finally:
        _kernel32.CloseHandle(handle)


results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))


def wait_finish(pid=None, timeout=1800, poll=1.0, track_peak=False):
    """等待导入结束；track_peak 时轮询并记录子进程峰值 RSS。"""
    t0 = time.time()
    saw_pid = False
    peak = -1.0
    st = get_import_status()
    while time.time() - t0 < timeout:
        st = get_import_status()
        if st.get("worker_pid"):
            saw_pid = True
        if track_peak and pid and _pid_alive(pid):
            cur = rss_mb(pid)
            if cur > peak:
                peak = cur
        if not st["is_running"]:
            break
        time.sleep(poll)
    return st, saw_pid, peak


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--real", default=None, help="真实导入的 Excel 路径（会写数据库）")
    args = parser.parse_args()

    st0 = get_import_status()
    if st0["is_running"]:
        print("已有导入在运行，冒烟中止")
        return 2

    print(f"主进程 pid={os.getpid()}  RSS={rss_mb():.1f} MB")
    rss_before = rss_mb()
    before_tmp = set(glob.glob(os.path.join(tempfile.gettempdir(), "restock_import_*")))

    if args.real:
        print(f"真实模式：{args.real}（会写数据库）")
        res = start_import_async(file_path=args.real, tenant_id=1)
    else:
        res = start_import_async(file_content=b"this is definitely not a valid xlsx",
                                 filename="smoke_bad.xlsx", tenant_id=1)
    print(f"start_import_async -> {res}")

    pid = res.get("pid")
    check("子进程已启动", res.get("started") is True, str(res))
    check("pid 为主进程之外的子进程", bool(pid) and pid != os.getpid(), f"pid={pid}")

    st, saw_pid, peak = wait_finish(pid=pid, track_peak=bool(args.real))
    print(f"结束状态: is_running={st['is_running']} progress={st['progress']} "
          f"total_rows={st['total_rows']} replen={st['replen_count']} error={st['error']!r}")

    check("状态跨进程可见（读到子进程 worker_pid）", saw_pid)
    check("worker_pid 属于子进程", st.get("worker_pid") == pid, f"{st.get('worker_pid')} vs {pid}")
    check("导入收敛为 is_running=False", st["is_running"] is False)
    check("finished_at 已写入", bool(st.get("finished_at")))
    if args.real:
        check("真实导入无错误", not st.get("error"), str(st.get("error")))
        check("真实导入读到数据行", (st.get("total_rows") or 0) > 0, f"total_rows={st.get('total_rows')}")
    else:
        check("失败原因被记录（非法 Excel）", bool(st.get("error")))

    # 等子进程真正退出：is_running 只代表「导入本体」结束，
    # 步骤9 的飞书同步仍在子进程内执行，之后进程才退出（RSS 此时归零）
    t_exit = time.time() + 300
    proc_gone = False
    while time.time() < t_exit:
        if not _pid_alive(pid):
            proc_gone = True
            break
        time.sleep(1.0)
    check("子进程已退出（pid 不再存活）", proc_gone, "等待 300s 后仍存活")
    # 进程退出后由内核回收其全部地址空间 —— 这是 OS 语义，不再用 OpenProcess 复核：
    # PID 可能被系统立即复用，复核会给出误导性的正值。
    if proc_gone:
        print(f"子进程 {pid} 已退出，其峰值 RSS 已由内核整体回收")

    leftover = set(glob.glob(os.path.join(tempfile.gettempdir(), "restock_import_*"))) - before_tmp
    check("上传临时文件已清理", not leftover, f"残留={leftover}")

    rss_after = rss_mb()
    delta = rss_after - rss_before
    print(f"主进程 RSS: {rss_before:.1f} -> {rss_after:.1f} MB (Δ{delta:+.1f})")
    if args.real:
        print(f"子进程峰值 RSS: {peak:.1f} MB  <- 这批数据实际占用在这里，且随进程退出消失")
    check("主进程 RSS 增幅 < 30MB（数据不在主进程）", delta < 30, f"Δ={delta:+.1f}MB")

    ok = sum(1 for _, c, _ in results if c)
    print("=" * 64)
    for name, passed, detail in results:
        line = f"  [{'PASS' if passed else 'FAIL'}] {name}"
        if detail and not passed:
            line += f"  -> {detail}"
        print(line)
    print("=" * 64)
    print(f"{ok}/{len(results)} PASS")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
