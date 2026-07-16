import React from "react";
import { Tag } from "antd";

interface SuggestionStatusTagProps {
  status: string;
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  pending: { color: "orange", label: "待处理" },
  confirmed: { color: "blue", label: "已确认" },
  executed: { color: "green", label: "已执行" },
  ignored: { color: "default", label: "已忽略" },
  expired: { color: "red", label: "已失效" },
};

const SuggestionStatusTag: React.FC<SuggestionStatusTagProps> = ({ status }) => {
  const config = STATUS_CONFIG[status] || { color: "default", label: status };
  return <Tag color={config.color}>{config.label}</Tag>;
};

export default SuggestionStatusTag;
