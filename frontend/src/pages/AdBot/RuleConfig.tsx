import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Row,
  Col,
  Switch,
  Tag,
  Space,
  Spin,
  Button,
  message,
  Typography,
  Divider,
  Modal,
} from "antd";
import { adRulesApi } from "../../api";
import { useTheme } from "../../contexts/ThemeContext";
import RuleThresholdEditor from "./components/RuleThresholdEditor";

const { Text, Paragraph } = Typography;

interface RuleCondition {
  metric: string;
  operator: string;
  threshold: number;
  unit?: string;
}

interface PredefinedRule {
  id: number;
  name: string;
  rule_type: string;
  priority: string; // 后端返回中文 高/中
  description: string;
  conditions: RuleCondition[];
  actions: string[];
  is_enabled: boolean;
}

// 优先级映射：后端返回中文 高/中
const PRIORITY_COLORS: Record<string, string> = {
  "高": "red",
  "中": "orange",
  "低": "blue",
  high: "red",
  medium: "orange",
  low: "blue",
};

const PRIORITY_LABELS: Record<string, string> = {
  "高": "高",
  "中": "中",
  "低": "低",
  high: "高",
  medium: "中",
  low: "低",
};

// 规则类型映射
const RULE_TYPE_LABELS: Record<string, string> = {
  adjust_bid: "调整竞价",
  increase_budget: "增加预算",
  pause: "暂停",
  add_negative: "添加否定",
  optimization: "综合优化",
};

const METRIC_LABELS: Record<string, string> = {
  acos: "ACOS",
  roas: "ROAS",
  ctr: "CTR",
  spend: "花费",
  budget: "预算",
  budget_utilization: "预算利用率",
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
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [toggling, setToggling] = useState<Record<number, boolean>>({});

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adRulesApi.getPredefined();
      if (res.data.success) {
        const ruleList: PredefinedRule[] = res.data.data || [];
        setRules(ruleList);
        // 初始化阈值
        const initThresholds: Record<number, Record<number, number>> = {};
        ruleList.forEach((rule) => {
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

  const handleToggle = async (
    rule: PredefinedRule,
    enabled: boolean,
  ) => {
    // 乐观更新
    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, is_enabled: enabled } : r)),
    );
    setToggling((prev) => ({ ...prev, [rule.id]: true }));
    try {
      const res = await adRulesApi.updatePredefined(rule.id, {
        is_enabled: enabled,
      });
      if (res.data.success) {
        message.success(enabled ? "规则已启用" : "规则已禁用");
      } else {
        // 回滚
        setRules((prev) =>
          prev.map((r) => (r.id === rule.id ? { ...r, is_enabled: rule.is_enabled } : r)),
        );
        message.error("状态更新失败");
      }
    } catch (e) {
      // 回滚
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, is_enabled: rule.is_enabled } : r)),
      );
      message.error("状态更新失败");
    } finally {
      setToggling((prev) => ({ ...prev, [rule.id]: false }));
    }
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

  const handleSaveThresholds = (rule: PredefinedRule) => {
    // 校验阈值
    const invalid = (rule.conditions || []).some((_, idx) => {
      const v = thresholds[rule.id]?.[idx];
      return v === undefined || v === null || Number.isNaN(v);
    });
    if (invalid) {
      message.warning("请填写有效的阈值");
      return;
    }

    Modal.confirm({
      title: "确认保存阈值",
      content: `确定要修改规则"${rule.name}"的阈值吗？`,
      okText: "确定",
      cancelText: "取消",
      onOk: async () => {
        setSaving((prev) => ({ ...prev, [rule.id]: true }));
        try {
          const newConditions = (rule.conditions || []).map((cond, idx) => ({
            ...cond,
            threshold: thresholds[rule.id]?.[idx] ?? cond.threshold,
          }));
          const res = await adRulesApi.updatePredefined(rule.id, {
            conditions: newConditions,
          });
          if (res.data.success) {
            message.success("阈值保存成功，重启服务后生效");
            // 更新本地规则的 conditions，保持与后端一致
            setRules((prev) =>
              prev.map((r) =>
                r.id === rule.id ? { ...r, conditions: newConditions } : r,
              ),
            );
          } else {
            message.error("阈值保存失败");
          }
        } catch (e) {
          message.error("阈值保存失败");
        } finally {
          setSaving((prev) => ({ ...prev, [rule.id]: false }));
        }
      },
    });
  };

  return (
    <Spin spinning={loading}>
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">
          共 {rules.length} 条预定义规则，修改阈值后请点击"保存阈值"按钮。阈值保存后需重启后端服务生效。
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
                    loading={toggling[rule.id]}
                    onChange={(checked) => handleToggle(rule, checked)}
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
                  <Tag color="blue">
                    {RULE_TYPE_LABELS[rule.rule_type] || rule.rule_type}
                  </Tag>
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
                    min={0}
                  />
                ))}
                <Button
                  size="small"
                  type="primary"
                  loading={saving[rule.id]}
                  onClick={() => handleSaveThresholds(rule)}
                  style={{ background: currentTheme.primary }}
                >
                  保存阈值
                </Button>

                <Divider style={{ margin: "8px 0" }} />

                <Text strong>执行动作:</Text>
                <div>
                  {(rule.actions || []).map((action, idx) => (
                    <Tag key={idx} color="geekblue" style={{ marginBottom: 4 }}>
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
