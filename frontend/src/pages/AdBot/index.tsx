import React, { useState } from "react";
import { Tabs } from "antd";
import Overview from "./Overview";
import CampaignAnalysis from "./CampaignAnalysis";
import KeywordAnalysis from "./KeywordAnalysis";
import SearchTermAnalysis from "./SearchTermAnalysis";
import ProductAnalysis from "./ProductAnalysis";
import SuggestionManagement from "./SuggestionManagement";
import RuleConfig from "./RuleConfig";
import ExecutionLogView from "./ExecutionLogView";

const AdBotPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState("overview");

  const tabItems = [
    { key: "overview", label: "广告概览", children: <Overview /> },
    { key: "campaign", label: "活动分析", children: <CampaignAnalysis /> },
    { key: "keyword", label: "关键词", children: <KeywordAnalysis /> },
    { key: "search_term", label: "搜索词", children: <SearchTermAnalysis /> },
    { key: "product", label: "产品", children: <ProductAnalysis /> },
    { key: "suggestion", label: "建议", children: <SuggestionManagement /> },
    { key: "rule", label: "规则", children: <RuleConfig /> },
    { key: "log", label: "日志", children: <ExecutionLogView /> },
  ];

  return (
    <div style={{ padding: "24px" }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        size="large"
      />
    </div>
  );
};

export default AdBotPage;
