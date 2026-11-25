import React from "react";
import { Tag, Tooltip } from "antd";

/**
 * 月销量等级徽标（S/A/B/C/D/E）—— 等级池页与库存页共用，色板单一真源。
 * 视觉语言与全站统一（antd Tag 预设色，浅底色字）：
 *   S=gold / A=volcano / B=blue / C=cyan（暖→冷递进），E/D=default 灰（视觉退后）。
 * 预设色主值与 GRADE_MAIN_COLOR 同源（gold-7/volcano-6/blue-6/cyan-6），
 * 等级池统计卡、分布带沿用同一色板。
 */
export const GRADE_RANK: Record<string, number> = { S: 6, A: 5, B: 4, C: 3, E: 2, D: 1 };

/** 各档 antd Tag color 预设名 */
const TAG_COLOR: Record<string, string> = {
  S: "gold",
  A: "volcano",
  B: "blue",
  C: "cyan",
  E: "default",
  D: "default",
};

/** 各档主色（统计卡/分布带等场景用） */
export const GRADE_MAIN_COLOR: Record<string, string> = {
  S: "#D48806",
  A: "#FA541C",
  B: "#1677FF",
  C: "#13C2C2",
  D: "#8C8C8C",
  E: "#BFBFBF",
};

export const GRADE_ORDER: string[] = ["S", "A", "B", "C", "D", "E"];
/** 各档的对外语义名（tooltip/筛选文案用） */
export const GRADE_LABEL: Record<string, string> = {
  S: "爆款（301+）",
  A: "热销（101~300）",
  B: "稳定动销（31~100）",
  C: "缓慢动销（11~30）",
  E: "微量动销（1~10）",
  D: "未动销（0/暂无销量）",
};

interface GradeBadgeProps {
  grade?: string | null;
  /** 等级池未生成时的占位提示 */
  emptyTip?: string;
  size?: "small" | "middle";
}

const GradeBadge: React.FC<GradeBadgeProps> = ({ grade, emptyTip, size = "middle" }) => {
  if (!grade || !GRADE_RANK[grade]) {
    return (
      <Tooltip title={emptyTip || "等级池未生成或该产品上月无数据"}>
        <span style={{ color: "#bbb" }}>-</span>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={GRADE_LABEL[grade]}>
      <Tag
        color={TAG_COLOR[grade]}
        style={{
          marginRight: 0,
          fontWeight: 600,
          fontSize: size === "small" ? 11 : 12,
          lineHeight: "18px",
        }}
      >
        {grade}
      </Tag>
    </Tooltip>
  );
};

export default GradeBadge;
