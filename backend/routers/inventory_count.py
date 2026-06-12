from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime
from urllib.parse import quote
import json
import logging

from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User
from services.excel_helper import create_inventory_count_template, parse_inventory_count_excel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/inventory-count", tags=["inventory_count"])


@router.get("/template")
async def download_count_template(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """下载仓库盘存模板"""
    try:
        excel_bytes = create_inventory_count_template(db, current_user.tenant_id)
        filename = f"仓库盘存模板_{datetime.now().strftime('%Y%m%d')}.xlsx"
        return StreamingResponse(
            excel_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"}
        )
    except Exception as e:
        logger.error(f"下载盘存模板失败: {e}")
        raise HTTPException(status_code=500, detail=f"下载模板失败: {str(e)}")


@router.post("/upload")
async def upload_count_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """上传盘存文件，对比差异"""
    try:
        if not file.filename or not file.filename.endswith(('.xlsx', '.xls')):
            raise HTTPException(status_code=400, detail="请上传Excel文件(.xlsx/.xls)")

        file_bytes = await file.read()
        if len(file_bytes) == 0:
            raise HTTPException(status_code=400, detail="文件为空")

        items = parse_inventory_count_excel(file_bytes, db, current_user.tenant_id)

        if not items:
            raise HTTPException(status_code=400, detail="没有解析到有效数据")

        diff_items = [item for item in items if item["has_difference"]]
        total_items = len(items)
        diff_count = len(diff_items)

        return {
            "success": True,
            "data": {
                "items": items,
                "total": total_items,
                "diff_count": diff_count,
                "has_diff": diff_count > 0,
            },
            "message": f"盘点完成，共 {total_items} 条记录，{diff_count} 条有差异"
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"盘存文件解析失败: {e}")
        raise HTTPException(status_code=500, detail=f"盘存文件解析失败: {str(e)}")


@router.post("/confirm")
async def confirm_inventory_count(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """确认盘存结果，更新库存并发送差异通知"""
    try:
        body = await request.body()
        data = json.loads(body)
        items = data.get("items", [])

        if not items:
            raise HTTPException(status_code=400, detail="没有需要确认的数据")

        diff_items = [item for item in items if item.get("has_difference")]

        # 关键: 更新 inventory_batches 批次表，而不只是 products.local_quantity
        # 因为产品列表和库存详情都从 inventory_batches 读取数量
        now = datetime.now()
        batch_number_prefix = f"PD{now.strftime('%Y%m%d')}"

        for item in diff_items:
            pid = item["product_id"]
            target_qty = item["count_quantity"]  # 盘点后的目标数量
            warehouse = item.get("warehouse", "") or ""

            # 查找该产品现有的批次
            batches = db.execute(text("""
                SELECT id, current_quantity, initial_quantity, batch_number, unit_price
                FROM inventory_batches
                WHERE product_id = :pid AND tenant_id = :tid AND deleted_at IS NULL
                ORDER BY created_at DESC
            """), {"pid": pid, "tid": current_user.tenant_id}).fetchall()

            if batches:
                # 有现有批次：调整最新批次的 current_quantity
                # 逻辑：先把所有批次的 current_quantity 都设为0，然后把总数量放到最新一批
                total_batch_qty = sum(b[1] for b in batches)
                diff = target_qty - total_batch_qty

                if diff != 0:
                    # 获取最新批次
                    latest_batch = batches[0]
                    new_latest_qty = max(0, latest_batch[1] + diff)

                    # 更新最新批次
                    db.execute(text("""
                        UPDATE inventory_batches
                        SET current_quantity = :cq, updated_at = :now
                        WHERE id = :bid
                    """), {
                        "cq": new_latest_qty,
                        "now": now,
                        "bid": latest_batch[0],
                    })
            else:
                # 没有现有批次：创建一个"盘存调整"批次
                if target_qty > 0:
                    # 获取产品采购价作为批次单价
                    product_info = db.execute(text("""
                        SELECT purchase_price, product_code
                        FROM products WHERE id = :pid AND tenant_id = :tid
                    """), {"pid": pid, "tid": current_user.tenant_id}).fetchone()
                    unit_price = float(product_info[0]) if product_info and product_info[0] else 0

                    # 生成唯一批次号
                    existing_count = db.execute(text("""
                        SELECT COUNT(*) FROM inventory_batches
                        WHERE tenant_id = :tid AND batch_number LIKE :prefix
                    """), {"tid": current_user.tenant_id, "prefix": f"{batch_number_prefix}%"}).scalar() or 0
                    batch_num = f"{batch_number_prefix}-{(existing_count + 1):04d}"

                    db.execute(text("""
                        INSERT INTO inventory_batches
                        (tenant_id, product_id, batch_number, initial_quantity, current_quantity,
                         locked_quantity, unit_price, warehouse, inbound_date, status, notes)
                        VALUES
                        (:tid, :pid, :bn, :iq, :cq, 0, :up, :wh, :now, 'active', :notes)
                    """), {
                        "tid": current_user.tenant_id,
                        "pid": pid,
                        "bn": batch_num,
                        "iq": target_qty,
                        "cq": target_qty,
                        "up": unit_price,
                        "wh": warehouse,
                        "now": now,
                        "notes": "盘存调整",
                    })

            # 同步更新 products.local_quantity 和 local_warehouse
            db.execute(text("""
                UPDATE products
                SET local_quantity = :qty, local_warehouse = :wh, updated_at = :now
                WHERE id = :pid AND tenant_id = :tid
            """), {
                "qty": target_qty,
                "wh": warehouse,
                "pid": pid,
                "tid": current_user.tenant_id,
                "now": now,
            })

        # 提交库存更新
        db.commit()

        # 发送差异通知（失败不影响库存更新）
        if diff_items:
            try:
                notification_users = db.execute(text("""
                    SELECT id FROM users
                    WHERE tenant_id = :tid AND deleted_at IS NULL
                """), {"tid": current_user.tenant_id}).fetchall()

                if notification_users:
                    diff_detail_lines = []
                    for item in diff_items:
                        diff_detail_lines.append(
                            f"  {item['product_code']} {item['product_name']}: "
                            f"系统库存 {item['system_quantity']} → 盘点 {item['count_quantity']} "
                            f"(差异: {'+' if item['difference'] > 0 else ''}{item['difference']})"
                        )

                    title = f"仓库盘存差异通知 - {datetime.now().strftime('%Y-%m-%d %H:%M')}"
                    content = (
                        f"【盘存差异】\n"
                        f"操作人：{current_user.username}\n\n"
                        f"以下产品库存存在差异：\n" + "\n".join(diff_detail_lines)
                    )

                    for (uid,) in notification_users:
                        db.execute(text("""
                            INSERT INTO notifications (tenant_id, user_id, type, title, content, link)
                            VALUES (:tid, :uid, 'warning', :title, :content, '/products')
                        """), {
                            "tid": current_user.tenant_id,
                            "uid": uid,
                            "title": title,
                            "content": content,
                        })

                    db.commit()
            except Exception as notify_err:
                logger.warning(f"发送盘存通知失败（不影响库存更新）: {notify_err}")
                db.rollback()

        logger.info(f"盘存确认完成，操作人: {current_user.username}, 差异项: {len(diff_items)}")

        return {
            "success": True,
            "message": f"盘存确认成功，更新了 {len(diff_items)} 个产品的库存",
            "data": {
                "updated_count": len(diff_items),
                "total_count": len(items),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"确认盘存失败: {e}")
        raise HTTPException(status_code=500, detail=f"确认盘存失败: {str(e)}")