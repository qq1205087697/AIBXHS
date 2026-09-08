import React, { useMemo } from "react";
import { Progress, Typography, Empty } from "antd";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const { Text } = Typography;

interface DimensionInfo {
  score: number;
  max: number;
  value: number;
}

interface HealthScoreCardProps {
  score: number;
  level: string;
  dimensions?: Record<string, DimensionInfo>;
}

const LEVEL_COLOR_MAP: Record<string, string> = {
  优秀: "#52c41a",
  良好: "#1890ff",
  一般: "#faad14",
  差: "#ff4d4f",
};

const DIMENSION_LABELS: Record<string, string> = {
  acos: "ACOS",
  roas: "ROAS",
  ctr: "CTR",
  cvr: "CVR",
  budget_utilization: "预算利用率",
  cpc: "CPC",
};

const HealthScoreCard: React.FC<HealthScoreCardProps> = ({
  score,
  level,
  dimensions,
}) => {
  const color = LEVEL_COLOR_MAP[level] || "#1890ff";

  const radarData = useMemo(() => {
    if (!dimensions) return [];
    return Object.entries(dimensions).map(([key, info]) => ({
      dimension: DIMENSION_LABELS[key] || key,
      score: Number(info?.score ?? 0),
      max: Number(info?.max ?? 100),
    }));
  }, [dimensions]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px",
      }}
    >
      <Progress
        type="circle"
        percent={Math.min(Math.max(score, 0), 100)}
        strokeColor={color}
        format={() => (
          <span style={{ fontSize: 24, fontWeight: 600, color }}>{score}</span>
        )}
        size={120}
      />
      <Text
        style={{
          marginTop: 8,
          fontSize: 16,
          fontWeight: 600,
          color,
        }}
      >
        {level}
      </Text>
      <Text type="secondary" style={{ marginTop: 2, marginBottom: 8 }}>
        健康分
      </Text>

      {radarData.length > 0 ? (
        <ResponsiveContainer width="100%" height={200}>
          <RadarChart data={radarData} outerRadius="70%">
            <PolarGrid />
            <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
            <PolarRadiusAxis
              angle={90}
              domain={[0, Math.max(...radarData.map((d) => d.max), 100)]}
              tick={false}
            />
            <Radar
              name="得分"
              dataKey="score"
              stroke={color}
              fill={color}
              fillOpacity={0.4}
            />
            <Tooltip
              formatter={(v: number, _name, item) => {
                const max = (item && (item as any).payload?.max) || 100;
                return [`${v} / ${max}`, "得分"];
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="无维度数据"
          style={{ marginTop: 16 }}
        />
      )}
    </div>
  );
};

export default HealthScoreCard;
