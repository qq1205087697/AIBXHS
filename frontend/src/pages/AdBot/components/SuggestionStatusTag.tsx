import React from "react";
import { Tag } from "antd";

interface SuggestionStatusTagProps {
  status: string;
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  "待处理": { color: "orange", label: "待处理" },
  "已确认": { color: "blue", label: "已确认" },
  "已执行": { color: "green", label: "已执行" },
  "已忽略": { color: "default", label: "已忽略" },
  "已失效": { color: "red", label: "已失效" },
};

const SuggestionStatusTag: React.FC<SuggestionStatusTagProps> = ({ status }) => {
  const config = STATUS_CONFIG[status] || { color: "default", label: status };
  return <Tag color={config.color}>{config.label}</Tag>;
};

export default SuggestionStatusTag;
