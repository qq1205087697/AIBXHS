from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any, Optional
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy.orm import Session
from database.database import get_db
from models.finance import FinanceRecord, FinanceCategory, FinanceTemplate
from dependencies import get_current_user
from models.user import User

router = APIRouter(prefix="/finance", tags=["finance"])

# 收支类型白名单
FLOW_TYPES = ["收入", "支出"]

# ============ 种子数据（租户首次访问分类接口时初始化） ============
SEED_L1 = [
    # (name, icon, color, remark)
    ("税务", "Landmark", "#cf1322", "VAT / 关税 / 申报缴费流水"),
    ("工资", "Users", "#722ed1", "薪资发放 / 社保公积金流水"),
    ("采购", "ShoppingBag", "#1890ff", "采购付款 / 应付账款流水"),
    ("服务商", "Briefcase", "#13c2c2", "服务商合同费用 / 月结账单流水"),
    ("物流商", "Truck", "#fa8c16", "头程/尾程运费 / 对账付款流水"),
    ("收款", "Banknote", "#389e0d", "平台回款 / 到账流水"),
    ("核查", "SearchCheck", "#faad14", "差异调整 / 异常流水冲正"),
    ("广告费", "Megaphone", "#eb2f96", "各店铺广告花费流水"),
    ("房租物业", "Building2", "#8c8c8c", "办公室/仓库租金 / 物业水电流水"),
    ("平台费用", "Store", "#fa541c", "平台佣金 / FBA配送仓储费扣款流水"),
    ("其他", "Wallet", "#d9d9d9", "其他收支流水"),
]
SEED_L2 = {
    "税务": ["VAT申报", "关税", "税务服务费", "其他税费", "其他"],
    "工资": ["基本工资", "绩效奖金", "社保公积金", "补贴", "其他"],
    "采购": ["采购货款", "采购定金", "样品费", "模具费", "其他"],
    "服务商": ["财税代理", "商标专利", "系统软件", "摄影设计", "其他"],
    "物流商": ["头程运费", "尾程派送", "海外仓费用", "退货处理", "其他"],
    "收款": ["平台回款", "其他收入", "其他"],
    "核查": ["差异冲正", "赔付追回", "异常调整", "其他"],
    "广告费": ["SP广告", "SB广告", "SD广告", "秒杀费用", "其他"],
    "房租物业": ["办公室租金", "仓库租金", "物业水电", "其他"],
    "平台费用": ["平台佣金", "FBA配送费", "FBA仓储费", "店铺月租", "其他"],
    "其他": ["杂项", "其他"],
}


def _seed_categories(db: Session, tenant_id: int) -> None:
    """为租户初始化默认一级/二级分类"""
    for idx, (name, icon, color, remark) in enumerate(SEED_L1):
        cat = FinanceCategory(
            tenant_id=tenant_id, parent_id=None, name=name, sort=idx,
            is_system=1, remark=remark, icon=icon, color=color,
        )
        db.add(cat)
        db.flush()  # 拿到 id 供二级分类挂载
        for s_idx, sub_name in enumerate(SEED_L2.get(name, [])):
            db.add(FinanceCategory(
                tenant_id=tenant_id, parent_id=cat.id, name=sub_name,
                sort=s_idx, is_system=1,
            ))
    db.commit()


def _serialize_cat(cat: FinanceCategory) -> Dict[str, Any]:
    return {
        "id": cat.id,
        "parentId": cat.parent_id,
        "name": cat.name,
        "sort": cat.sort or 0,
        "isSystem": bool(cat.is_system),
        "remark": cat.remark or "",
        "icon": cat.icon or "",
        "color": cat.color or "",
    }


@router.get("/categories")
async def list_finance_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """查询分类（一级+二级平铺）；租户无数据时自动初始化种子分类"""
    try:
        tenant_id = current_user.tenant_id
        cats = db.query(FinanceCategory).filter(
            FinanceCategory.tenant_id == tenant_id,
            FinanceCategory.deleted_at.is_(None),
        ).all()
        if not cats:
            _seed_categories(db, tenant_id)
            cats = db.query(FinanceCategory).filter(
                FinanceCategory.tenant_id == tenant_id,
                FinanceCategory.deleted_at.is_(None),
            ).all()
        cats.sort(key=lambda c: ((c.sort or 0), c.id))
        return {"success": True, "data": [_serialize_cat(c) for c in cats]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询分类失败: {str(e)}")


@router.put("/categories/reorder")
async def reorder_finance_categories(
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """批量调整排序：ids 按新顺序排列，sort 按数组下标重写（用于二级分类上移/下移）"""
    ids = payload.get("ids") or []
    if not ids:
        raise HTTPException(status_code=400, detail="ids 不能为空")
    try:
        tenant_id = current_user.tenant_id
        cats = db.query(FinanceCategory).filter(
            FinanceCategory.tenant_id == tenant_id,
            FinanceCategory.deleted_at.is_(None),
            FinanceCategory.id.in_(ids),
        ).all()
        by_id = {c.id: c for c in cats}
        for idx, cid in enumerate(ids):
            c = by_id.get(cid)
            if c:
                c.sort = idx
        db.commit()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"排序失败: {str(e)}")


@router.post("/categories")
async def create_finance_category(
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """新增分类（parent_id 为空=一级分类）"""
    try:
        tenant_id = current_user.tenant_id
        name = str(payload.get("name") or "").strip()
        parent_id = payload.get("parent_id")
        if not name:
            raise HTTPException(status_code=400, detail="分类名称不能为空")
        if len(name) > 50:
            raise HTTPException(status_code=400, detail="分类名称不能超过 50 字符")
        if parent_id is not None:
            parent = db.query(FinanceCategory).filter(
                FinanceCategory.id == parent_id,
                FinanceCategory.tenant_id == tenant_id,
                FinanceCategory.parent_id.is_(None),
                FinanceCategory.deleted_at.is_(None),
            ).first()
            if not parent:
                raise HTTPException(status_code=400, detail="父级分类不存在")
        # 同级重名校验
        dup = db.query(FinanceCategory).filter(
            FinanceCategory.tenant_id == tenant_id,
            FinanceCategory.name == name,
            FinanceCategory.deleted_at.is_(None),
            FinanceCategory.parent_id == parent_id if parent_id is not None else FinanceCategory.parent_id.is_(None),
        ).first()
        if dup:
            raise HTTPException(status_code=400, detail="同级下已存在同名分类")
        max_sort = db.query(FinanceCategory).filter(
            FinanceCategory.tenant_id == tenant_id,
            FinanceCategory.deleted_at.is_(None),
            FinanceCategory.parent_id == parent_id if parent_id is not None else FinanceCategory.parent_id.is_(None),
        ).count()
        cat = FinanceCategory(
            tenant_id=tenant_id, parent_id=parent_id, name=name,
            sort=max_sort, is_system=0,
        )
        db.add(cat)
        db.commit()
        db.refresh(cat)
        return {"success": True, "data": _serialize_cat(cat)}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"新增分类失败: {str(e)}")


@router.put("/categories/{cat_id}")
async def update_finance_category(
    cat_id: int,
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """编辑分类（重命名/排序）；一级分类改名会同步更新流水的冗余文本"""
    try:
        tenant_id = current_user.tenant_id
        cat = db.query(FinanceCategory).filter(
            FinanceCategory.id == cat_id,
            FinanceCategory.tenant_id == tenant_id,
            FinanceCategory.deleted_at.is_(None),
        ).first()
        if not cat:
            raise HTTPException(status_code=404, detail=f"分类不存在: {cat_id}")
        old_name = cat.name
        new_name = str(payload.get("name") or "").strip()
        if new_name and new_name != old_name:
            dup = db.query(FinanceCategory).filter(
                FinanceCategory.tenant_id == tenant_id,
                FinanceCategory.name == new_name,
                FinanceCategory.deleted_at.is_(None),
                FinanceCategory.parent_id == cat.parent_id if cat.parent_id is not None else FinanceCategory.parent_id.is_(None),
                FinanceCategory.id != cat_id,
            ).first()
            if dup:
                raise HTTPException(status_code=400, detail="同级下已存在同名分类")
            cat.name = new_name
            # 一级分类改名 → 同步流水冗余文本，保证旧流水仍归属该板块
            if cat.parent_id is None:
                db.query(FinanceRecord).filter(
                    FinanceRecord.tenant_id == tenant_id,
                    FinanceRecord.category == old_name,
                ).update({FinanceRecord.category: new_name}, synchronize_session=False)
        if payload.get("sort") is not None:
            cat.sort = int(payload["sort"])
        if "remark" in payload:
            cat.remark = str(payload.get("remark") or "").strip() or None
        db.commit()
        db.refresh(cat)
        return {"success": True, "data": _serialize_cat(cat)}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"编辑分类失败: {str(e)}")


@router.delete("/categories/{cat_id}")
async def delete_finance_category(
    cat_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删除分类（软删除）。内置分类、有子级或被流水引用的分类不允许删除"""
    try:
        tenant_id = current_user.tenant_id
        cat = db.query(FinanceCategory).filter(
            FinanceCategory.id == cat_id,
            FinanceCategory.tenant_id == tenant_id,
            FinanceCategory.deleted_at.is_(None),
        ).first()
        if not cat:
            raise HTTPException(status_code=404, detail=f"分类不存在: {cat_id}")
        if cat.parent_id is None:
            has_children = db.query(FinanceCategory).filter(
                FinanceCategory.parent_id == cat_id,
                FinanceCategory.deleted_at.is_(None),
            ).first()
            if has_children:
                raise HTTPException(status_code=400, detail="该一级分类下还有二级分类，请先删除二级分类")
        referenced = db.query(FinanceRecord).filter(
            FinanceRecord.tenant_id == tenant_id,
            FinanceRecord.deleted_at.is_(None),
            (FinanceRecord.category_id == cat_id) | (FinanceRecord.sub_category_id == cat_id),
        ).first()
        if referenced:
            raise HTTPException(status_code=400, detail="该分类已被流水记录引用，不能删除")
        cat.deleted_at = datetime.now()
        db.commit()
        return {"success": True, "data": {"id": cat_id}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除分类失败: {str(e)}")


def _serialize_tpl(tpl: FinanceTemplate, cats_map: Dict[int, str]) -> Dict[str, Any]:
    sub_ids = tpl.items or []
    return {
        "id": tpl.id,
        "name": tpl.name,
        "categoryId": tpl.category_id,
        "items": [{"subCategoryId": sid, "subName": cats_map.get(sid, f"已删除#{sid}")} for sid in sub_ids],
    }


def _load_templates(tenant_id: int, db: Session) -> list:
    tpls = db.query(FinanceTemplate).filter(
        FinanceTemplate.tenant_id == tenant_id,
        FinanceTemplate.deleted_at.is_(None),
    ).order_by(FinanceTemplate.id.desc()).all()
    cat_ids = {t.category_id for t in tpls}
    sub_ids = {sid for t in tpls for sid in (t.items or [])}
    cats_map: Dict[int, str] = {}
    if cat_ids or sub_ids:
        rows = db.query(FinanceCategory).filter(FinanceCategory.id.in_(list(cat_ids | sub_ids))).all()
        cats_map = {c.id: c.name for c in rows}
    return [_serialize_tpl(t, cats_map) for t in tpls]


def _validate_tpl_items(db: Session, tenant_id: int, category_id: int, sub_ids: list) -> None:
    """校验模板子项：必须属于本租户、必须是二级分类、必须挂在所选一级分类下"""
    if not sub_ids:
        raise HTTPException(status_code=400, detail="模板至少要选择一个二级分类")
    if len(set(sub_ids)) != len(sub_ids):
        raise HTTPException(status_code=400, detail="模板子项不能重复")
    subs = db.query(FinanceCategory).filter(
        FinanceCategory.id.in_(sub_ids),
        FinanceCategory.tenant_id == tenant_id,
        FinanceCategory.parent_id.isnot(None),
        FinanceCategory.deleted_at.is_(None),
    ).all()
    found = {s.id: s for s in subs}
    for sid in sub_ids:
        if sid not in found:
            raise HTTPException(status_code=400, detail=f"二级分类不存在: {sid}")
        if found[sid].parent_id != category_id:
            raise HTTPException(status_code=400, detail=f"二级分类「{found[sid].name}」不属于所选一级分类")


@router.get("/templates")
async def list_finance_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """查询登记模板（含子项二级分类名）"""
    try:
        return {"success": True, "data": _load_templates(current_user.tenant_id, db)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询模板失败: {str(e)}")


@router.post("/templates")
async def create_finance_template(
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """新增登记模板"""
    try:
        tenant_id = current_user.tenant_id
        name = str(payload.get("name") or "").strip()
        category_id = payload.get("category_id")
        sub_ids = payload.get("sub_category_ids") or []
        if not name:
            raise HTTPException(status_code=400, detail="模板名称不能为空")
        if len(name) > 50:
            raise HTTPException(status_code=400, detail="模板名称不能超过 50 字符")
        if not category_id:
            raise HTTPException(status_code=400, detail="请选择所属一级分类")
        l1 = db.query(FinanceCategory).filter(
            FinanceCategory.id == category_id,
            FinanceCategory.tenant_id == tenant_id,
            FinanceCategory.parent_id.is_(None),
            FinanceCategory.deleted_at.is_(None),
        ).first()
        if not l1:
            raise HTTPException(status_code=400, detail="一级分类不存在")
        _validate_tpl_items(db, tenant_id, category_id, sub_ids)
        tpl = FinanceTemplate(tenant_id=tenant_id, name=name, category_id=category_id, items=sub_ids)
        db.add(tpl)
        db.commit()
        db.refresh(tpl)
        return {"success": True, "data": _load_templates(tenant_id, db)[0]}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"新增模板失败: {str(e)}")


@router.put("/templates/{tpl_id}")
async def update_finance_template(
    tpl_id: int,
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """编辑模板（名称/子项）"""
    try:
        tenant_id = current_user.tenant_id
        tpl = db.query(FinanceTemplate).filter(
            FinanceTemplate.id == tpl_id,
            FinanceTemplate.tenant_id == tenant_id,
            FinanceTemplate.deleted_at.is_(None),
        ).first()
        if not tpl:
            raise HTTPException(status_code=404, detail=f"模板不存在: {tpl_id}")
        new_name = str(payload.get("name") or "").strip()
        if new_name:
            tpl.name = new_name
        sub_ids = payload.get("sub_category_ids")
        if sub_ids is not None:
            _validate_tpl_items(db, tenant_id, tpl.category_id, sub_ids)
            tpl.items = sub_ids
        db.commit()
        return {"success": True, "data": _load_templates(tenant_id, db)[0]}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"编辑模板失败: {str(e)}")


@router.delete("/templates/{tpl_id}")
async def delete_finance_template(
    tpl_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删除模板（软删除）"""
    try:
        tpl = db.query(FinanceTemplate).filter(
            FinanceTemplate.id == tpl_id,
            FinanceTemplate.tenant_id == current_user.tenant_id,
            FinanceTemplate.deleted_at.is_(None),
        ).first()
        if not tpl:
            raise HTTPException(status_code=404, detail=f"模板不存在: {tpl_id}")
        tpl.deleted_at = datetime.now()
        db.commit()
        return {"success": True, "data": {"id": tpl_id}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除模板失败: {str(e)}")


def _serialize(record: FinanceRecord, sub_name: Optional[str] = None) -> Dict[str, Any]:
    return {
        "id": record.id,
        "category": record.category,
        "categoryId": record.category_id,
        "subCategoryId": record.sub_category_id,
        "subCategoryName": sub_name or "",
        "flowType": record.flow_type,
        "recordDate": record.record_date.strftime("%Y-%m-%d") if record.record_date else None,
        "amount": float(record.amount) if isinstance(record.amount, Decimal) else record.amount,
        "description": record.description or "",
        "createdBy": record.created_by or "",
        "createdAt": record.created_at.strftime("%Y-%m-%d %H:%M") if record.created_at else None,
    }


@router.get("/records")
async def list_finance_records(
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """查询财务流水（按租户隔离，支持板块/日期范围过滤），附带二级分类名"""
    try:
        query = db.query(FinanceRecord).filter(
            FinanceRecord.tenant_id == current_user.tenant_id,
            FinanceRecord.deleted_at.is_(None),
        )
        if category:
            query = query.filter(FinanceRecord.category == category)
        if start_date:
            query = query.filter(FinanceRecord.record_date >= start_date)
        if end_date:
            query = query.filter(FinanceRecord.record_date <= end_date)
        records = query.order_by(FinanceRecord.record_date.desc(), FinanceRecord.id.desc()).all()
        # 一次性取二级分类名映射
        sub_ids = {r.sub_category_id for r in records if r.sub_category_id}
        sub_map: Dict[int, str] = {}
        if sub_ids:
            subs = db.query(FinanceCategory).filter(FinanceCategory.id.in_(sub_ids)).all()
            sub_map = {s.id: s.name for s in subs}
        return {"success": True, "data": [_serialize(r, sub_map.get(r.sub_category_id)) for r in records]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询财务流水失败: {str(e)}")


@router.post("/records")
async def create_finance_record(
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """登记一条财务流水（日期/金额/收支类型/板块/二级分类/摘要）"""
    try:
        tenant_id = current_user.tenant_id
        flow_type = str(payload.get("flow_type") or "").strip()
        record_date = str(payload.get("record_date") or "").strip()
        amount = payload.get("amount")
        description = str(payload.get("description") or "").strip()
        category_id = payload.get("category_id")
        sub_category_id = payload.get("sub_category_id")

        # 一级分类：优先按 id 校验（新流程），无 id 时回退文本白名单（兼容旧调用）
        category_text = ""
        if category_id is not None:
            l1 = db.query(FinanceCategory).filter(
                FinanceCategory.id == category_id,
                FinanceCategory.tenant_id == tenant_id,
                FinanceCategory.parent_id.is_(None),
                FinanceCategory.deleted_at.is_(None),
            ).first()
            if not l1:
                raise HTTPException(status_code=400, detail=f"一级分类不存在: {category_id}")
            category_text = l1.name
        else:
            category_text = str(payload.get("category") or "").strip()
            if category_text not in [n for n, *_ in SEED_L1]:
                raise HTTPException(status_code=400, detail=f"无效的费用板块: {category_text}")

        # 二级分类：校验归属
        if sub_category_id is not None:
            sub = db.query(FinanceCategory).filter(
                FinanceCategory.id == sub_category_id,
                FinanceCategory.tenant_id == tenant_id,
                FinanceCategory.parent_id.isnot(None),
                FinanceCategory.deleted_at.is_(None),
            ).first()
            if not sub:
                raise HTTPException(status_code=400, detail=f"二级分类不存在: {sub_category_id}")
            if category_id is not None and sub.parent_id != category_id:
                raise HTTPException(status_code=400, detail=f"二级分类「{sub.name}」不属于所选一级分类")

        if flow_type not in FLOW_TYPES:
            raise HTTPException(status_code=400, detail=f"无效的收支类型: {flow_type}")
        try:
            parsed_date = datetime.strptime(record_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效的日期格式: {record_date}（应为 YYYY-MM-DD）")
        try:
            parsed_amount = Decimal(str(amount))
        except Exception:
            raise HTTPException(status_code=400, detail=f"无效的金额: {amount}")
        if parsed_amount <= 0:
            raise HTTPException(status_code=400, detail="金额必须大于 0")

        record = FinanceRecord(
            tenant_id=tenant_id,
            category=category_text,
            category_id=category_id,
            sub_category_id=sub_category_id,
            flow_type=flow_type,
            record_date=parsed_date,
            amount=parsed_amount,
            description=description or None,
            created_by=current_user.username,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        sub_name = None
        if record.sub_category_id:
            sub_row = db.query(FinanceCategory).filter(FinanceCategory.id == record.sub_category_id).first()
            sub_name = sub_row.name if sub_row else None
        return {"success": True, "data": _serialize(record, sub_name)}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"登记财务流水失败: {str(e)}")


@router.delete("/records/{record_id}")
async def delete_finance_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删除财务流水（软删除）"""
    try:
        record = db.query(FinanceRecord).filter(
            FinanceRecord.id == record_id,
            FinanceRecord.tenant_id == current_user.tenant_id,
            FinanceRecord.deleted_at.is_(None),
        ).first()
        if not record:
            raise HTTPException(status_code=404, detail=f"记录不存在: {record_id}")
        record.deleted_at = datetime.now()
        db.commit()
        return {"success": True, "data": {"id": record_id}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除财务流水失败: {str(e)}")
