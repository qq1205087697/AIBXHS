"""行政机器人路由 - 行政人力资源官职责清单

依据行政人力资源思维导图搭建：
1.招聘 2.入职 3.解决公司内部需求 4.完善公司规章制度事宜 5.离职
每个租户首次访问自动播种目录，支持事项增删改、状态流转、负责人指派。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.database import get_db
from dependencies import get_current_user, get_current_admin_user
from models.admin_robot_item import AdminRobotItem
from models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin-robot", tags=["admin-robot"])

# 行政人力资源官初始目录（分类 -> 分组 -> [(事项, 说明)]）
SEED_TREE = {
    "招聘": {
        "发岗位": [("岗位要求、薪资条件", "")],
        "一轮面试": [("安排二轮、三轮面试", "")],
        "背景调查": [
            ("表现", ""),
            ("离职原因是否一致", ""),
            ("上家公司薪资", ""),
        ],
    },
    "入职": {
        "入职资料": [
            ("身份证", ""),
            ("体检报告", ""),
            ("毕业证", ""),
            ("上家公司离职证明", ""),
            ("银行卡资料", "开户行"),
            ("社保", "15号之前买当月，之后买次月"),
            ("公积金", "转正才买，不强制，自愿"),
        ],
        "签署合同": [],
        "公司资料记录": [("入职时间", ""), ("住址", ""), ("电话", "")],
    },
    "解决公司内部需求": {
        "放假事宜": [
            ("通知VX", "VX大群"),
            ("通知飞书", "飞书大群"),
            ("通知QQ", "QQ大群"),
        ],
        "同事之间关系事宜": [],
        "纪律事宜（每月需变动）": [
            ("玩手机", ""),
            ("睡觉", ""),
            ("上厕所", ""),
            ("仓库抽烟", "大吉哥，黄勇，白主管，王星宇"),
            ("考勤迟到较多", "问金金迟到比较多的"),
            ("业绩波动跟上月同比下降", "问金飘，业绩不好或者下降的，找对应主管谈话"),
        ],
        "绩效制定": [
            ("规划好组织架构", "哪个组忙不过来了，需要加人 —— 找到人主管的领导申请需求"),
            ("运营绩效考核", "询问金飘"),
            ("美工出图考核", "询问梁琪"),
            ("采购订单考核", "询问周姐"),
            ("IT业绩考核", "询问吴培"),
            ("仓库绩效考核", "询问白哥"),
            ("考勤-请假", "1天以内；超过一天可我来批"),
            ("考勤-迟到早退", ""),
            ("考勤-旷工", "没有任何请假，但是没有出现在岗位上"),
            ("社保公积金缴纳管理", "每月19号统计社保；每月25号统计公积金"),
        ],
        "验证码管理": [
            ("日常验证码接收与发送", ""),
            ("验证码手机来电监控", "告知对应部门主管"),
            ("账号登录IP监控", ""),
            ("记录每个平台每个账号对应验证码", "告诉曼延"),
        ],
        "检查月报": [("每条评论，收集关键信息进行汇报", "整条完发给我")],
        "公司耗材": [
            ("纸巾", ""), ("饮品", ""), ("零食", ""), ("水", ""), ("纸张", ""), ("打印墨盒", ""),
        ],
        "接待": [("卫生", ""), ("倒水", "会议室")],
    },
    "完善公司规章制度事宜": {
        "下午茶": [],
        "企业文化的建设-规章制度": [
            ("入职管理", ""), ("岗位规范", ""), ("考勤制度", ""), ("作息管理", ""),
            ("请假休假", ""), ("办公规范", ""), ("绩效考核", ""), ("保密准则", ""),
        ],
        "企业文化的建设-奖励处罚": [
            ("老员工福利奖", "2年有2000，之后每有年1000；3年以上年终奖翻倍"),
            ("开工奖", ""), ("年终奖", ""), ("中秋奖", ""),
        ],
        "员工手册": [],
        "劳动合同": [],
        "团建": [("制定活动计划", "")],
        "聚餐": [("寻找餐厅、场地，合适的价格", "")],
        "公司用品": [
            ("纸杯", ""), ("装饰品", ""),
            ("空调开关", "下期检查 —— 看茶室空调"),
            ("窗帘", "打开通风"),
        ],
        "节日礼品": [("发红包还是礼品", "问老板定基调")],
        "建立花名册": [],
    },
    "离职": {
        "主管员": [("通知老板", "")],
        "基层员": [("和主管商量是否留下", "")],
        "谈话": [("挽留", "挽留的话术"), ("不留", "不留的话术 —— 招聘")],
        "离职证明": [("通知财务停社保公积金", "")],
    },
}

CATEGORY_ORDER = list(SEED_TREE.keys())


def _seed_if_empty(db: Session, tenant_id: int) -> None:
    exists = db.query(AdminRobotItem.id).filter(AdminRobotItem.tenant_id == tenant_id).first()
    if exists:
        return
    rows = []
    for sort_cat, (cat, groups) in enumerate(SEED_TREE.items()):
        for group, items in groups.items():
            for i, (title, note) in enumerate(items):
                rows.append(AdminRobotItem(
                    tenant_id=tenant_id, category=cat, item_group=group,
                    title=title, note=note or None, sort=sort_cat * 1000 + i,
                ))
    if rows:
        db.add_all(rows)
        db.commit()
        logger.info("行政机器人目录已播种: tenant=%s, %s 条", tenant_id, len(rows))


class AdminItemCreate(BaseModel):
    category: str
    item_group: str = ""
    title: str
    note: Optional[str] = None
    assignee: Optional[str] = None


class AdminItemUpdate(BaseModel):
    title: Optional[str] = None
    note: Optional[str] = None
    assignee: Optional[str] = None
    status: Optional[str] = None
    item_group: Optional[str] = None
    category: Optional[str] = None


@router.get("/tree")
def get_tree(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """返回完整目录树 + 统计（按租户隔离，首次访问自动播种）"""
    _seed_if_empty(db, current_user.tenant_id)
    rows = (
        db.query(AdminRobotItem)
        .filter(AdminRobotItem.tenant_id == current_user.tenant_id)
        .order_by(AdminRobotItem.sort, AdminRobotItem.id)
        .all()
    )
    tree: dict = {}
    for r in rows:
        cat = tree.setdefault(r.category, {"category": r.category, "groups": {}, "total": 0, "done": 0})
        grp = cat["groups"].setdefault(r.item_group or "", {"group": r.item_group or "", "items": []})
        grp["items"].append({
            "id": r.id, "title": r.title, "note": r.note,
            "assignee": r.assignee, "status": r.status,
        })
        cat["total"] += 1
        if r.status == "已完成":
            cat["done"] += 1
    categories = []
    for cat in CATEGORY_ORDER:
        if cat in tree:
            c = tree[cat]
            c["groups"] = list(c["groups"].values())
            categories.append(c)
    for cat, c in tree.items():
        if cat not in CATEGORY_ORDER:
            c["groups"] = list(c["groups"].values())
            categories.append(c)
    total = sum(c["total"] for c in categories)
    done = sum(c["done"] for c in categories)
    return {"success": True, "data": {"categories": categories, "total": total, "done": done}}


@router.post("/items")
def create_item(
    payload: AdminItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not payload.title.strip():
        raise HTTPException(400, "事项标题不能为空")
    item = AdminRobotItem(
        tenant_id=current_user.tenant_id,
        category=payload.category.strip(),
        item_group=(payload.item_group or "").strip(),
        title=payload.title.strip(),
        note=payload.note,
        assignee=payload.assignee,
        sort=999999,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"success": True, "data": {"id": item.id}}


@router.patch("/items/{item_id}")
def update_item(
    item_id: int,
    payload: AdminItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(AdminRobotItem)
        .filter(AdminRobotItem.id == item_id, AdminRobotItem.tenant_id == current_user.tenant_id)
        .first()
    )
    if not item:
        raise HTTPException(404, "事项不存在")
    if payload.title is not None and payload.title.strip():
        item.title = payload.title.strip()
    if payload.note is not None:
        item.note = payload.note
    if payload.assignee is not None:
        item.assignee = payload.assignee
    if payload.status is not None and payload.status in {"未开始", "进行中", "已完成"}:
        item.status = payload.status
    if payload.category is not None and payload.category.strip():
        item.category = payload.category.strip()
    if payload.item_group is not None:
        item.item_group = payload.item_group.strip()
    db.commit()
    return {"success": True}


@router.delete("/items/{item_id}")
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    item = (
        db.query(AdminRobotItem)
        .filter(AdminRobotItem.id == item_id, AdminRobotItem.tenant_id == current_user.tenant_id)
        .first()
    )
    if not item:
        raise HTTPException(404, "事项不存在")
    db.delete(item)
    db.commit()
    return {"success": True}
