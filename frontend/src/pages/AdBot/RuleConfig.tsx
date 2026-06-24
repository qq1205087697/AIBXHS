import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Row,
  Col,
  Switch,
  Tag,
  Space,
  Spin,
  message,
  Typography,
  Divider,
} from "antd";
import { adRulesApi } from "../../api";
import { useTheme } from "../../contexts/ThemeContext";
import RuleThresholdEditor from "./components/RuleThresholdEditor";

const { Text, Paragraph } = Typography;

interface PredefinedRule {
  id: number;
  name: string;
  rule_type: string;
  priority: string;
  description: string;
  conditions: {
    metric: string;
    operator: string;
    threshold: number;
    unit?: string;
  }[];
  actions: string[];
  is_enabled: boolean;
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "red",
  medium: "orange",
  low: "blue",
};

const PRIORITY_LABELS: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const METRIC_LABELS: Record<string, string> = {
  acos: "ACOS",
  roas: "ROAS",
  ctr: "CTR",
  spend: "花费",
  sales: "销售额",
  orders: "订单数",
  clicks: "点击数",
  impressions: "曝光量",
  cpc: "CPC",
  cvr: "CVR",
};

const RuleConfig: React.FC = () => {
  const { currentTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState<PredefinedRule[]>([]);
  const [thresholds, setThresholds] = useState<Record<number, Record<number, number>>>({});

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adRulesApi.getPredefined();
      if (res.data.success) {
        const ruleList = res.data.data || [];
        setRules(ruleList);
        // 初始化阈值
        const initThresholds: Record<number, Record<number, number>> = {};
        ruleList.forEach((rule: PredefinedRule) => {
          initThresholds[rule.id] = {};
          (rule.conditions || []).forEach((cond, idx) => {
            initThresholds[rule.id][idx] = cond.threshold;
          });
        });
        setThresholds(initThresholds);
      }
    } catch (e) {
      message.error("获取预定义规则失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleToggle = (id: number, enabled: boolean) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_enabled: enabled } : r)),
    );
    message.success(enabled ? "规则已启用" : "规则已禁用");
  };

  const handleThresholdChange = (
    ruleId: number,
    condIdx: number,
    value: number,
  ) => {
    setThresholds((prev) => ({
      ...prev,
      [ruleId]: { ...prev[ruleId], [condIdx]: value },
    }));
  };

  return (
    <Spin spinning={loading}>
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">
          共 {rules.length} 条预定义规则，阈值编辑仅展示用，不会实际保存
        </Text>
      </div>

      <Row gutter={[16, 16]}>
        {rules.map((rule) => (
          <Col xs={24} sm={12} lg={8} key={rule.id}>
            <Card
              title={
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{rule.name}</span>
                  <Switch
                    checked={rule.is_enabled}
                    onChange={(checked) => handleToggle(rule.id, checked)}
                  />
                </div>
              }
              styles={{
                header: {
                  borderBottom: `2px solid ${currentTheme.primaryBg}`,
                },
              }}
            >
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <div>
                  <Tag color={PRIORITY_COLORS[rule.priority] || "default"}>
                    优先级: {PRIORITY_LABELS[rule.priority] || rule.priority}
                  </Tag>
                  <Tag>{rule.rule_type}</Tag>
                </div>

                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  {rule.description}
                </Paragraph>

                <Divider style={{ margin: "8px 0" }} />

                <Text strong>触发条件:</Text>
                {(rule.conditions || []).map((cond, idx) => (
                  <RuleThresholdEditor
                    key={idx}
                    label={`${METRIC_LABELS[cond.metric] || cond.metric} ${cond.operator}`}
                    value={thresholds[rule.id]?.[idx] ?? cond.threshold}
                    onChange={(v) => handleThresholdChange(rule.id, idx, v)}
                    unit={cond.unit}
                  />
                ))}

                <Divider style={{ margin: "8px 0" }} />

                <Text strong>执行动作:</Text>
                <div>
                  {(rule.actions || []).map((action, idx) => (
                    <Tag key={idx} color="blue" style={{ marginBottom: 4 }}>
                      {action}
                    </Tag>
                  ))}
                </div>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      {rules.length === 0 && !loading && (
        <Card>
          <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
            暂无预定义规则
          </div>
        </Card>
      )}
    </Spin>
  );
};

export default RuleConfig;
