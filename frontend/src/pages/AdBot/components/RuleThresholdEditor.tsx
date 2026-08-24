import React from "react";
import { InputNumber, Typography, Space } from "antd";

const { Text } = Typography;

interface RuleThresholdEditorProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  unit?: string;
}

const RuleThresholdEditor: React.FC<RuleThresholdEditorProps> = ({
  value,
  onChange,
  label,
  unit,
}) => {
  return (
    <Space direction="vertical" size={4} style={{ width: "100%" }}>
      <Text type="secondary" style={{ fontSize: 13 }}>
        {label}
      </Text>
      <Space>
        <InputNumber
          value={value}
          onChange={(v) => onChange(typeof v === "number" ? v : 0)}
          style={{ width: 140 }}
          precision={2}
        />
        {unit && <Text type="secondary">{unit}</Text>}
      </Space>
    </Space>
  );
};

export default RuleThresholdEditor;
