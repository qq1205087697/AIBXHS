#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""库存导入子进程入口。

为什么用独立子进程而不是线程：
    导入过程中 pandas / SQLAlchemy 会申请数百 MB 内存（Excel 解析 +173MB、
    calculate_replenishment 峰值 +418MB），线程结束后 glibc allocator 的
    arena 高水位与 Session 缓存不会归还给操作系统。放到子进程里跑，进程一退出
    内核就无条件回收全部 RSS，问题结构性消失。

用法（由 services.inventory_import_service.start_import_async 调用）：
    python -m services.import_worker --file <xlsx> --tenant 1 [--filename 名] [--cleanup 临时文件]
"""
import argparse
import os
import sys
import time
import traceback


def _load_all_models() -> None:
    """预加载 backend/models 下的全部模型模块。

    SQLAlchemy 的 relationship 用字符串引用（例如 Tenant 上的 "ProductSelection"），
    只有所有相关类都已注册时 mapper 才能完成配置。uvicorn 主进程启动时会走
    main.py → database.init_db() 把全部模型导入一遍，但本子进程是全新解释器，
    若不自行导入，calculate_replenishment 一碰 ORM query 就会抛
    InvalidRequestError（ProductSelection 找不到）——步骤 1~7 用原生 SQL
    不会暴露，步骤 8 才会炸。

    注意：models/__init__.py 并未导全，所以按目录动态扫描而不是依赖它。
    """
    import importlib
    import pkgutil

    import models as models_pkg

    for module_info in pkgutil.iter_modules(models_pkg.__path__):
        try:
            importlib.import_module(f"models.{module_info.name}")
        except Exception as exc:  # 单个模型导入失败不阻断主流程，但要能看见
            print(f"[worker] 模型加载跳过 models.{module_info.name}: {exc}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="库存补货建议导入子进程")
    parser.add_argument("--file", required=True, help="Excel 文件路径")
    parser.add_argument("--tenant", type=int, default=1, help="租户ID")
    parser.add_argument("--filename", default=None, help="原始文件名（仅用于日志）")
    parser.add_argument("--cleanup", default=None, help="导入结束后删除的临时文件路径")
    args = parser.parse_args()

    try:
        _load_all_models()

        from services.inventory_import_service import _do_import, _import_status

        # 记录 pid：主进程据此判断子进程是否还活着
        _import_status["worker_pid"] = os.getpid()

        _do_import(
            file_path=args.file,
            filename=args.filename or os.path.basename(args.file),
            tenant_id=args.tenant,
            wait_for_sync=True,
        )
        return 0
    except Exception as e:
        # _do_import 内部已有 try/except，这里是最后的兜底（例如 import 阶段就挂了）
        traceback.print_exc()
        try:
            from services.inventory_import_service import _import_status
            _import_status.update({
                "is_running": False,
                "error": str(e),
                "finished_at": time.time(),
            })
        except Exception:
            pass
        return 1
    finally:
        if args.cleanup and os.path.exists(args.cleanup):
            try:
                os.remove(args.cleanup)
            except OSError:
                pass


if __name__ == "__main__":
    sys.exit(main())
