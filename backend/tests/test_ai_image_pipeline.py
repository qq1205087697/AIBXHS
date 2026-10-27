# -*- coding: utf-8 -*-
"""AI 生图链路回归测试（纯函数层，不触网、不写库）。

覆盖本次改造的关键契约：
- 多参考图工作流注入（8 张上限、AUTOGROW/PE 通道挂载）
- 比例白名单（缺失即报错，不静默降级）
- 状态聚合（含已取消）
- 入参校验（伪造图片/超像素/超张数）
- 错误归因与文本截断
- 提交幂等

运行：cd backend && python -m pytest tests/test_ai_image_pipeline.py -q
"""
from __future__ import annotations

import io
import json
import os
import sys

import pytest
from fastapi import HTTPException
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers import ai_image as R
from services import ai_image_service as S


# ---------- 多参考图工作流 ----------

def test_workflow_injects_extra_reference_images():
    wf = S._build_workflow(
        prompt="p", aspect_ratio="2:3", seed=7,
        image_names=["a.jpg", "b.jpg", "c.jpg"], filename_prefix="T",
    )
    assert wf["475"]["inputs"]["image"] == "a.jpg"
    assert wf["9002"]["inputs"]["image"] == "b.jpg"
    assert wf["9003"]["inputs"]["image"] == "c.jpg"
    assert wf["497"]["inputs"]["images.image_1"] == ["532", 0]
    assert wf["497"]["inputs"]["images.image_2"] == ["9102", 0]
    assert wf["497"]["inputs"]["images.image_3"] == ["9103", 0]
    assert wf["565"]["inputs"]["图片2"] == ["9102", 0]
    assert wf["565"]["inputs"]["图片3"] == ["9103", 0]


def test_workflow_all_node_refs_exist():
    wf = S._build_workflow(
        prompt="p", aspect_ratio="1:1", seed=1,
        image_names=[f"x{i}.jpg" for i in range(1, 9)], filename_prefix="T",
    )
    ids = set(wf)
    for nid, node in wf.items():
        for key, val in (node.get("inputs") or {}).items():
            if isinstance(val, list) and len(val) == 2 and isinstance(val[0], str) and val[0].isdigit():
                assert val[0] in ids, f"节点 {nid}.{key} 引用不存在的 {val[0]}"


def test_workflow_rejects_ninth_reference_image():
    with pytest.raises(S.AIImageError):
        S._build_workflow(
            prompt="p", aspect_ratio="1:1", seed=1,
            image_names=[f"x{i}.jpg" for i in range(1, 10)], filename_prefix="T",
        )


def test_workflow_applies_megapixels_and_ratio():
    wf = S._build_workflow(
        prompt="p", aspect_ratio="21:9", seed=1,
        image_names=["a.jpg"], filename_prefix="T", megapixels=1.0,
    )
    assert wf["13"]["inputs"]["aspect_ratio"] == "21:9 (Ultrawide)"
    assert wf["13"]["inputs"]["megapixels"] == 1.0


# ---------- 比例白名单 ----------

def test_ratio_unknown_key_raises():
    with pytest.raises(S.AIImageError):
        S.resolve_ratio_label("7:5")


def test_ratio_missing_on_server_raises_not_fallback(monkeypatch):
    """服务端选项表不含该比例时必须报错，不能悄悄用 1:1。"""
    monkeypatch.setattr(S, "_supported_ratio_options", lambda force=False: ["1:1 (Square)"])
    with pytest.raises(S.AIImageError) as ei:
        S.resolve_ratio_label("16:9")
    assert "不支持" in str(ei.value)


def test_ratio_probe_unavailable_allows_static_mapping(monkeypatch):
    """探测不可达时不阻断静态映射（服务抖动不应让整页不可用）。"""
    monkeypatch.setattr(S, "_supported_ratio_options", lambda force=False: None)
    assert S.resolve_ratio_label("16:9") == "16:9 (Widescreen)"


# ---------- 状态聚合 ----------

@pytest.mark.parametrize("statuses,expected", [
    (["已完成", "已完成"], "已完成"),
    (["失败", "失败"], "失败"),
    (["已取消", "已取消"], "已取消"),
    (["已完成", "失败"], "部分完成"),
    (["已完成", "已取消"], "部分完成"),
    (["排队中", "已完成"], "生成中"),
    (["生成中", "失败"], "生成中"),
    ([], "生成中"),
])
def test_aggregate_status(statuses, expected):
    items = [{"status": s} for s in statuses]
    assert S._aggregate_status(items) == expected


# ---------- 入参校验 ----------

class _StubUpload:
    def __init__(self, data: bytes, filename: str, content_type: str):
        self.file = io.BytesIO(data)
        self.filename = filename
        self.content_type = content_type


def _png(size=(64, 64)):
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 200, 200)).save(buf, format="PNG")
    return buf.getvalue()


def test_validate_images_accepts_real_png():
    out = R._validate_images([_StubUpload(_png(), "a.png", "image/png")])
    assert len(out) == 1 and out[0][0] == "a.png" and out[0][1]


def test_validate_images_rejects_fake_mime():
    with pytest.raises(HTTPException) as ei:
        R._validate_images([_StubUpload(b"not an image", "a.jpg", "image/jpeg")])
    assert ei.value.status_code == 400
    assert "无法解析" in ei.value.detail


def test_validate_images_rejects_unsupported_type():
    with pytest.raises(HTTPException) as ei:
        R._validate_images([_StubUpload(b"x", "a.txt", "text/plain")])
    assert ei.value.status_code == 400


def test_validate_images_rejects_too_many():
    files = [_StubUpload(_png(), f"{i}.png", "image/png") for i in range(S.MAX_REF_IMAGES + 1)]
    with pytest.raises(HTTPException) as ei:
        R._validate_images(files)
    assert str(S.MAX_REF_IMAGES) in ei.value.detail


def test_validate_images_rejects_oversized_pixels(monkeypatch):
    monkeypatch.setattr(R, "MAX_IMAGE_PIXELS", 100)
    with pytest.raises(HTTPException) as ei:
        R._validate_images([_StubUpload(_png((64, 64)), "a.png", "image/png")])
    assert "分辨率" in ei.value.detail


# ---------- 文本与错误 ----------

def test_safe_text_truncates_to_column_width():
    assert S._safe_text("x" * 500, 200) == "x" * 200
    assert S._safe_text("  hi  ", 10) == "hi"
    assert S._safe_text("", 10) is None
    assert S._safe_text(None, 10) is None


@pytest.mark.parametrize("raw,hint_kw", [
    ("CUDA out of memory", "显存"),
    ("Failed to load checkpoint", "模型"),
    ("cannot identify image file", "参考图"),
    ("Connection refused", "连接"),
])
def test_humanize_comfy_error(raw, hint_kw):
    assert hint_kw in S.humanize_comfy_error(raw)


def test_humanize_comfy_error_unknown_returns_empty():
    assert S.humanize_comfy_error("something weird happened") == ""
    assert S.humanize_comfy_error(None) == ""


def test_compile_brand_genes_skips_default_font():
    text = S._compile_brand_genes({
        "main_color": "墨绿", "font_style": "智能字体风格",
        "country": "US 美国", "language": "英语",
    })
    assert "主色调" in text and "墨绿" in text
    assert "文字排版风格" not in text          # 智能字体风格是默认值，不应写入提示词
    assert "US 美国" in text


def test_build_prompt_hardened_keeps_constraints_not_camera_params():
    """brief 式：业务约束写死，场景设计交给 PE；不写死摄影参数"""
    p = S._build_prompt("scene_person", "品名：测试杯", "", "")
    assert "品名：测试杯" in p
    assert "商品不变量" in p and "一件都不能少" in p, "件数不得增减必须写死"
    assert "儿童" in p
    for banned in ("f/2.8", "色温", "等效"):
        assert banned not in p, f"不应写死摄影参数：{banned}"

    p3 = S._build_prompt("selling_point", "核心卖点：加厚杯壁", "杯口朝上", "")
    assert "杯口朝上" in p3 and "补充要求" in p3


def test_build_prompt_falls_back_to_v3_when_hardening_disabled(monkeypatch):
    """一键撤回：IMAGE_LOCAL_HARDENED_PROMPT=False 回到 v3 轻量版"""
    monkeypatch.setattr(S.settings, "IMAGE_LOCAL_HARDENED_PROMPT", False)
    p = S._build_prompt("scene", "品名：测试杯", "", "")
    assert "外观以参考图为准" in p
    assert "【" not in p, "v3 轻量版不使用重段落标记"
    assert "必须保留" not in p


# ---------- 幂等 ----------

def test_idempotency_hit_and_inflight():
    key = "test-key-1"
    assert R._idem_check(key) == {}
    # 占位中：第二次调用返回 inflight 标记
    assert R._idem_check(key).get("__inflight__") is True
    R._idem_settle(key, {"id": 99})
    assert R._idem_check(key) == {"id": 99}
    R._idem_settle(key)


def test_idempotency_empty_key_is_noop():
    assert R._idem_check("") == {}
    R._idem_settle("", {"id": 1})   # 不应抛异常


# ---------- 运行代号（取消后立刻重试的竞态隔离）----------

def test_run_token_superseded():
    """新执行接管后，旧线程的代号必须判为过期，否则会覆盖重试结果"""
    tid = 990001
    t1 = S._new_run_token(tid)
    assert S._is_current_token(tid, t1)
    t2 = S._new_run_token(tid)
    assert t2 == t1 + 1
    assert not S._is_current_token(tid, t1)
    assert S._is_current_token(tid, t2)


def test_run_token_unknown_task_not_current():
    assert not S._is_current_token(990002, 1)


# ---------- 商品事实合并 ----------

def test_merge_facts_prefers_user_fields():
    """用户已填字段优先，自动分析只补缺失项（避免提示词出现两行品名）"""
    user = "品名：海钓蛋糕装饰\n材质：亚克力"
    auto = "品名：钓鱼摆件\n颜色：蓝色\n核心卖点：立体造型"
    out = S._merge_facts(user, auto)
    assert out.count("品名：") == 1
    assert "品名：海钓蛋糕装饰" in out
    assert "材质：亚克力" in out
    assert "颜色：蓝色" in out and "核心卖点：立体造型" in out


def test_merge_facts_handles_empty_sides():
    assert S._merge_facts("品名：A", "") == "品名：A"
    assert S._merge_facts("", "品名：B") == "品名：B"
    assert S._merge_facts("", "") == ""


# ---------- result_images 落库预算（MySQL Text 64KB） ----------

def test_dump_items_clips_long_prompt_fields():
    """单条超长提示词必须裁剪，否则 12 张叠起来会超 Text 上限"""
    items = [{
        "type": "scene", "label": "场景图", "seq": 0, "status": "已完成", "url": "u",
        "error": None, "final_prompt": "提" * 9000, "prompt_cn": "中" * 3000,
        "inventory": [f"piece {i}" for i in range(20)],
    }]
    d = json.loads(S._dump_items(items))
    assert len(d[0]["final_prompt"]) == S._PROMPT_FIELD_LIMIT + 1   # 截断 + 省略号
    assert len(d[0]["prompt_cn"]) == S._PROMPT_CN_LIMIT + 1
    assert len(d[0]["inventory"]) == S._INVENTORY_MAX_ITEMS
    assert d[0]["status"] == "已完成" and d[0]["url"] == "u"


def test_dump_items_stays_within_text_column_budget():
    """12 张 × 超长中文商品信息：必须收敛到预算内，否则 1406 会让任务永远卡在生成中"""
    items = [{
        "type": "scene", "label": "场景图", "seq": i, "status": "已完成",
        "url": f"u{i}", "error": None,
        "final_prompt": "品名：" + "超长商品信息" * 1200,
        "enhanced_prompt": "enh " * 2000,
        "prompt_cn": "中文对照" * 600,
        "inventory": [f"piece{i}-{j}" for j in range(15)],
    } for i in range(12)]
    raw = S._dump_items(items)
    assert len(raw.encode("utf-8")) <= S._RESULT_JSON_BUDGET
    rows = json.loads(raw)
    assert len(rows) == 12
    assert all(r["status"] == "已完成" and r["url"] for r in rows), "状态与图片地址永不裁剪"


def test_dump_items_edge_cases():
    assert S._dump_items([]) == "[]"
    assert S._dump_items(None) == "[]"
    tricky = 'a"\nb\\c'          # 引号/换行/反斜杠必须原样往返
    assert json.loads(S._dump_items([{"final_prompt": tricky}]))[0]["final_prompt"] == tricky


# ---------- 重试下标 ----------

def test_pick_retry_targets_dedupes_and_filters():
    items = [{"status": "失败"}, {"status": "已完成"}, {"status": "已取消"}, {"status": "生成中"}]
    retryable = ("失败", "已取消")
    assert S._pick_retry_targets(items, [0, 0, 2, 2, 1], retryable) == [0, 2]
    assert S._pick_retry_targets(items, None, retryable) == [0, 2]
    assert S._pick_retry_targets(items, [99, -1, 3], retryable) == []


# ---------- 主参考图清晰度排序 ----------

def test_order_images_by_clarity_puts_largest_first():
    """产品库首图常是 75px 缩略图：主参考图必须换成清晰的那张（否则看图全错）"""
    tiny = ("tiny.jpg", _png((75, 75)))
    big = ("big.jpg", _png((600, 600)))
    mid = ("mid.jpg", _png((200, 200)))
    out = S._order_images_by_clarity([tiny, big, mid])
    assert [n for n, _ in out] == ["big.jpg", "mid.jpg", "tiny.jpg"]


def test_order_images_keeps_original_order_on_tie():
    a = ("a.jpg", _png((100, 100)))
    b = ("b.jpg", _png((100, 100)))
    assert [n for n, _ in S._order_images_by_clarity([a, b])] == ["a.jpg", "b.jpg"]


def test_order_images_single_and_bad_bytes():
    one = [("a.jpg", _png((10, 10)))]
    assert S._order_images_by_clarity(one)[0][0] == "a.jpg"
    # 解不开的字节按「最不清晰」处理，不能抛错
    assert S._image_area(b"not an image") == 0
    out = S._order_images_by_clarity([("bad.jpg", b"xx"), ("ok.jpg", _png((300, 300)))])
    assert out[0][0] == "ok.jpg"


# ---------- 商品信息卡（复用生视频分析）----------

def test_card_to_text_maps_video_fields_and_drops_uncertain():
    card = {
        "product_name_cn": "希腊月桂皇冠套装",
        "product_name_en": "Gold Laurel Leaf Tiara Set",
        "product_type": "蛋糕装饰",
        "material": ["金属合金", "仿水晶"],
        "colors": ["金色", "透明"],
        "product_components": ["头冠 x1", "链条 x1", "手镯 x2"],
        "product_size": "无法从图片确认",          # 必须被丢弃，不能当属性写进提示词
        "selling_points": ["叶片造型", "泪滴水晶"],
        "usage_methods": ["婚礼", "生日派对"],
        "usage_scenarios": ["不确定"],
    }
    text = S._card_to_text(card)
    assert "品名：希腊月桂皇冠套装" in text
    assert "材质：金属合金、仿水晶" in text
    assert "组件：头冠 x1、链条 x1、手镯 x2" in text
    assert "产品尺寸" not in text, "「无法从图片确认」不能进提示词"
    assert "不确定" not in text


def test_card_to_text_empty_card():
    assert S._card_to_text({}) == ""
    assert S._card_to_text({"product_size": ""}) == ""


def test_design_user_text_marks_card_authoritative():
    """design 阶段必须看到「已确认事实卡」，且明确不要重新识别"""
    from services import relay_image_service as RL
    txt = RL._design_user_text("scene", "1:1", "品名：皇冠\n组件：头冠 x1", "", "")
    assert "CONFIRMED PRODUCT CARD" in txt
    assert "do not re-identify" in txt
    assert "品名：皇冠" in txt
    # 没有卡时要说明「自己看图识别」，不能留空白让模型猜
    txt2 = RL._design_user_text("scene", "1:1", "", "", "")
    assert "empty" in txt2 and "identify the product from the image" in txt2


# ---------- 场景图：带人物 / 不带人物 ----------

def test_scene_variants_registered():
    """场景图区分两个变体；旧 key scene 必须保留（历史任务回填依赖它）"""
    assert "scene" in S.MAIN_GEN_TYPES and "scene_person" in S.MAIN_GEN_TYPES
    assert "不带人物" in S.MAIN_GEN_TYPES["scene"]
    assert "带人物" in S.MAIN_GEN_TYPES["scene_person"]
    from services import relay_image_service as RL
    assert "scene_person" in RL.SHOT_SPECS
    assert "NO people" in RL.SHOT_SPECS["scene"]


def test_scene_person_has_minor_ban_and_usage_rule():
    """带人物场景：成年模特 + 按使用方式佩戴 + 禁儿童"""
    from services import relay_image_service as RL
    spec = RL.SHOT_SPECS["scene_person"].lower()
    for kw in ("no children", "adult", "25-40", "wear or use", "waist chain"):
        assert kw in spec, f"缺少约束: {kw}"


def test_design_instruction_has_minor_guard():
    from services import relay_image_service as RL
    tpl = RL.DESIGN_INSTRUCTION.lower()
    assert "child, kid, teenager, minor" in tpl
    assert "adult" in tpl


def test_local_template_covers_both_scene_variants():
    """local 与 relay 共用 UI，缺模板会让提交直接 400"""
    for t in ("scene", "scene_person"):
        p = S._build_prompt(t, "品名：测试", "", "")
        assert "商品不变量" in p, f"{t} 缺件数约束"
    assert "儿童" in S._build_prompt("scene_person", "", "", "")
    assert "不出现任何人物" in S._build_prompt("scene", "", "", "")


# ---------- 设计输出截断治理 ----------

def test_design_max_tokens_configurable_and_retry_scales(monkeypatch):
    """截断时必须放大预算重试，而不是原地重试（原样重试必然再截断）"""
    from services import relay_image_service as RL
    seen = []

    def fake_post(base, key, model, content, timeout, **kw):
        seen.append(kw.get("max_tokens"))
        if len(seen) == 1:
            raise RL.RelayError("输出被 max_tokens=2600 截断")
        return '{"prompt_en":"keep the product; adult model","inventory":["tiara x1"],"prompt_cn":"保留商品","negative":"child"}'

    monkeypatch.setattr(RL, "_analyze_channel", lambda: {"base": "b", "key": "k", "model": "m"})
    monkeypatch.setattr(RL, "_post_chat", fake_post)
    monkeypatch.setattr(RL, "_shrink_for_analysis", lambda b: b)
    d = RL.design_shot_prompt(b"img", gen_type="scene_person", ratio="1:1", product_info="卡")
    assert seen[0] == RL.get_settings().IMAGE_RELAY_DESIGN_MAX_TOKENS
    assert seen[1] > seen[0], "重试必须放大 max_tokens"
    assert d["prompt_en"].startswith("keep the product")


def test_salvage_design_recovers_fields_from_truncated_json():
    """半截 JSON 也要能捞出已写完的 prompt_en / inventory"""
    from services import relay_image_service as RL
    truncated = (
        '{"product":{},"inventory":["letter balloon x1","witch hat balloon x1"],'
        '"prompt_en":"Keep the product exactly: two balloons, adult model wearing them.",'
        '"prompt_cn":"保留商品'
    )
    out = RL._salvage_design(truncated)
    assert out["prompt_en"].startswith("Keep the product exactly")
    assert out["inventory"] == ["letter balloon x1", "witch hat balloon x1"]
    assert "prompt_cn" not in out, "被截断的字段不能半截返回"


def test_salvage_design_empty_when_no_prompt():
    from services import relay_image_service as RL
    assert RL._salvage_design("") == {}
    assert RL._salvage_design('{"foo":"bar"') == {}


# ---------- 带人物场景：逐张差异化 ----------

def test_plan_design_jobs_expands_person_shots_only():
    """scene_person 每张一个设计任务；其他类型同类型只设计一次"""
    plan = [
        ("white_background", "1:1", None, "白底图", 0, False, 1.5),
        ("white_background", "1:1", None, "白底图", 1, False, 1.5),
        ("scene_person", "1:1", None, "场景图（带人物）", 0, False, 1.5),
        ("scene_person", "1:1", None, "场景图（带人物）", 1, False, 1.5),
        ("scene_person", "1:1", None, "场景图（带人物）", 2, False, 1.5),
        ("scene", "1:1", None, "场景图（不带人物）", 0, False, 1.5),
    ]
    jobs = S._plan_design_jobs(plan)
    assert [j[1] for j in jobs] == [
        "white_background", "scene_person", "scene_person", "scene_person", "scene",
    ]
    assert [j[0] for j in jobs] == [0, 2, 3, 4, 5]
    assert [j[3] for j in jobs if j[1] == "scene_person"] == [0, 1, 2]


def test_person_variations_are_pairwise_distinct():
    """四档变化必须在构图/姿态/光位/场景四个维度都不同，否则多张会撞图"""
    from services import relay_image_service as RL
    assert len(RL.PERSON_VARIATIONS) >= 4
    for key in ("framing", "pose", "light", "setting"):
        vals = [v[key] for v in RL.PERSON_VARIATIONS]
        assert len(set(vals)) == len(vals), f"{key} 存在重复"


def test_design_user_text_injects_variation():
    from services import relay_image_service as RL
    v = RL.PERSON_VARIATIONS[1]
    txt = RL._design_user_text("scene_person", "1:1", "卡", "", "", variation=v)
    assert "THIS SHOT" in txt
    assert v["framing"] in txt and v["light"] in txt and v["setting"] in txt
    assert "override" in txt
    # 不带人物时不应出现 THIS SHOT 段
    assert "THIS SHOT" not in RL._design_user_text("scene", "1:1", "卡", "", "")


def test_card_to_text_carries_style_context():
    """风格锚点进卡，保证同一任务多张图的场景主题一致"""
    text = S._card_to_text({"product_name_cn": "皇冠", "style_context": "greek classical"})
    assert "风格倾向：greek classical" in text


# ---------- 无人场景图：陈列载体 + 去人保商品 ----------

def test_scene_template_requires_display_and_keeps_product_when_removing_person():
    """参考图是模特穿戴照时，模型曾把商品连同人物一起删掉（实测空廊），
    必须写明陈列载体与画面占比，并禁止「去人连商品一起去」。"""
    p = S._build_prompt("scene", "品名：维京腰包套装", "", "")
    assert "陈列要求" in p, "无人场景必须写清商品怎么摆"
    assert "50~70%" in p, "必须给出商品画面占比，否则模型会填满场景"
    assert "参考图处理" in p
    assert "不得连同商品一起去掉" in p
    # brief 式：分析任务 + 场景委托 + 硬约束；环境不再由我们指定
    assert "看图分析" in p and "逐件清点" in p
    assert "不出现任何人物" in p
    assert "柱子、石阶" not in p and "拱门" not in p, "示例词不得再指向具体建筑风格"


def test_cn_variations_are_product_agnostic():
    """差异矩阵曾写死「冠沿/裙摆/腰链/石柱」（皇冠专用），换品后姿态不成立；
    环境指定也已移除——场景主题交给 PE 按商品风格设计"""
    banned = ("冠", "裙摆", "腰链", "手镯")
    for v in S.PERSON_VARIATIONS_CN:
        assert "setting" not in v, "环境指定必须移除"
        for key in ("framing", "pose", "light"):
            for b in banned:
                assert b not in v[key], f"{key} 绑定了具体商品：{v[key]}"
    # 必须保留「商品所在位置」占位语义，并给出解释句
    assert any("商品所在位置" in v["pose"] for v in S.PERSON_VARIATIONS_CN)
    p = S._build_prompt("scene_person", "品名：X", "", "",
                        variation=S.PERSON_VARIATIONS_CN[0])
    assert "实际的佩戴/使用部位理解" in p
    assert "场景环境由你按商品风格设计" in p
    p = S._build_prompt("scene_person", "品名：X", "", "",
                        variation=S.PERSON_VARIATIONS_CN[0])
    assert "实际的佩戴/使用部位理解" in p


# ---------- 超时后结果回收 ----------

def test_should_reclaim_only_timeout_failures():
    """只回收「超时失败」：重试接手/已回收/已取消都不能被旧图覆盖"""
    assert S._should_reclaim_item({"status": "失败", "error": "生成超时（超过 30 分钟）"})
    assert not S._should_reclaim_item({"status": "已完成", "url": "u"})
    assert not S._should_reclaim_item({"status": "排队中", "error": None})
    assert not S._should_reclaim_item({"status": "已取消", "error": "任务已取消"})
    assert not S._should_reclaim_item({"status": "失败", "error": "生成完成但未找到输出文件"})
    assert not S._should_reclaim_item({})


def test_timeout_recovery_delays_are_spread_out():
    """回收不能立即重试（ComfyUI 大概率还在排队），要有间隔且轮次有限"""
    d = S._TIMEOUT_RECOVERY_DELAYS
    assert 1 <= len(d) <= 4
    assert list(d) == sorted(d) and len(set(d)) == len(d)
    assert d[0] >= 60, "首轮至少等 60s，否则等于原地空转"


# ---------- 参考图模特：只借佩戴位置，不借人 ----------

def test_scene_person_does_not_copy_reference_model():
    """参考图里的模特曾被整体搬进成图（实测：墨绿泡泡裙被原样复制），
    必须写明只沿用佩戴位置，长相/服装/机位/姿态重新设计。"""
    p = S._build_prompt("scene_person", "品名：维京腰包\n使用方式：腰带系于腰部", "", "")
    assert "参考图模特处理" in p
    for kw in ("不得沿用其长相", "机位与姿态", "目标人群"):
        assert kw in p, f"缺少约束: {kw}"
    # 例外通道：运营在补充要求里显式要求时才沿用
    assert "明确要求沿用参考图的模特或姿态时，才沿用" in p
    # 年龄不做硬限制（面向中老年的商品要用中老年模特），只禁儿童
    assert "25~40" not in p and "25~35" not in p
    assert "严禁儿童" in p


def test_scene_forbids_reference_model_residue():
    p = S._build_prompt("scene", "品名：维京腰包", "", "")
    assert "不得连同商品一起去掉" in p
    assert "服装、发型与背景陈设也不得残留" in p
