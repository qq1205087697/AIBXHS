import React from "react";
import { Progress, Typography } from "antd";

const { Text } = Typography;

interface HealthScoreCardProps {
  score: number;
  level: string;
}

const LEVEL_COLOR_MAP: Record<string, string> = {
  优秀: "#52c41a",
  良好: "#1890ff",
  一般: "#faad14",
  差: "#ff4d4f",
};

const HealthScoreCard: React.FC<HealthScoreCardProps> = ({ score, level }) => {
  const color = LEVEL_COLOR_MAP[level] || "#1890ff";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <Progress
        type="circle"
        percent={Math.min(Math.max(score, 0), 100)}
        strokeColor={color}
        format={() => (
          <span style={{ fontSize: 24, fontWeight: 600, color }}>{score}</span>
        )}
        size={160}
      />
      <Text
        style={{
          marginTop: 12,
          fontSize: 18,
          fontWeight: 600,
          color,
        }}
      >
        {level}
      </Text>
      <Text type="secondary" style={{ marginTop: 4 }}>
        健康分
      </Text>
    </div>
  );
};

export default HealthScoreCard;
