import { useState } from "react";
import {
  Table,
  Button,
  Input,
  InputNumber,
  Space,
  Tag,
  message,
  Card,
  Typography,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { inventoryApi } from "../../api";

const { Title } = Typography;

interface Row {
  key: string;
  asin: string;
  sku: string;
  country: string;
  purchase_qty: number;
}

interface Result {
  asin: string;
  sku: string;
  country: string;
  purchase_qty: number;
  sales_30d: number;
  spot_qty: number;
  inbound_qty: number;
  judgment: string;
  red_qty: number;
  sea_qty: number;
}

// 判断结果 -> Tag 颜色映射
function getJudgmentColor(judgment: string): string {
  if (judgment === "全部海运") return "green";
  if (judgment === "红单补差额") return "orange";
  if (judgment === "运营自行判断") return "red";
  return "default"; // 灰色：SKU为空/全为0/无库存无在途
}

export default function AllocateShipmentTest() {
  const [rows, setRows] = useState<Row[]>([
    { key: "1", asin: "", sku: "", country: "美国", purchase_qty: 0 },
  ]);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        key: `${Date.now()}`,
        asin: "",
        sku: "",
        country: "美国",
        purchase_qty: 0,
      },
    ]);
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  };

  const updateRow = (key: string, field: keyof Row, value: any) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  };

  const calculate = async () => {
    // 校验输入：asin 和 sku 二选一
    const validRows = rows.filter(
      (r) => r.asin.trim() !== "" || r.sku.trim() !== "",
    );
    if (validRows.length === 0) {
      message.warning("请至少填写一行有效的 ASIN 或 SKU");
      return;
    }

    setLoading(true);
    try {
      const payload = validRows.map((r) => {
        const item: { asin?: string; sku?: string; country: string; purchase_qty: number } = {
          country: r.country.trim() || "美国",
          purchase_qty: r.purchase_qty,
        };
        // asin 和 sku 二选一：优先 sku
        if (r.sku.trim()) {
          item.sku = r.sku.trim();
        } else {
          item.asin = r.asin.trim();
        }
        return item;
      });
      const resp = await inventoryApi.allocateShipment(payload);
      const data = resp.data;
      // 兼容后端返回数组或 { results: [...] }
      const list: Result[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.results)
          ? data.results
          : Array.isArray(data?.data)
            ? data.data
            : [];
      setResults(list);
      if (list.length === 0) {
        message.info("计算完成，但未返回结果数据");
      } else {
        message.success(`计算完成，共 ${list.length} 条结果`);
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message ||
        "计算失败";
      message.error(msg);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const inputColumns: ColumnsType<Row> = [
    {
      title: "ASIN",
      dataIndex: "asin",
      width: 180,
      render: (_, record) => (
        <Input
          value={record.asin}
          onChange={(e) => updateRow(record.key, "asin", e.target.value)}
          placeholder="与SKU二选一"
          allowClear
          disabled={record.sku.trim() !== ""}
        />
      ),
    },
    {
      title: "SKU",
      dataIndex: "sku",
      width: 180,
      render: (_, record) => (
        <Input
          value={record.sku}
          onChange={(e) => updateRow(record.key, "sku", e.target.value)}
          placeholder="与ASIN二选一"
          allowClear
          disabled={record.asin.trim() !== ""}
        />
      ),
    },
    {
      title: "国家",
      dataIndex: "country",
      width: 160,
      render: (_, record) => (
        <Input
          value={record.country}
          onChange={(e) => updateRow(record.key, "country", e.target.value)}
          placeholder="请输入国家"
        />
      ),
    },
    {
      title: "进货数量",
      dataIndex: "purchase_qty",
      width: 180,
      render: (_, record) => (
        <InputNumber
          value={record.purchase_qty}
          min={0}
          step={1}
          style={{ width: "100%" }}
          onChange={(value) =>
            updateRow(record.key, "purchase_qty", value ?? 0)
          }
        />
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 100,
      render: (_, record) => (
        <Button
          type="link"
          danger
          icon={<DeleteOutlined />}
          onClick={() => removeRow(record.key)}
        >
          删除
        </Button>
      ),
    },
  ];

  const resultColumns: ColumnsType<Result> = [
    {
      title: "ASIN",
      dataIndex: "asin",
      width: 140,
    },
    {
      title: "SKU",
      dataIndex: "sku",
      width: 140,
    },
    {
      title: "国家",
      dataIndex: "country",
      width: 100,
    },
    {
      title: "进货数量",
      dataIndex: "purchase_qty",
      width: 100,
    },
    {
      title: "30天销量",
      dataIndex: "sales_30d",
      width: 110,
    },
    {
      title: "现货数量",
      dataIndex: "spot_qty",
      width: 110,
    },
    {
      title: "在途数量",
      dataIndex: "inbound_qty",
      width: 110,
    },
    {
      title: "判断结果",
      dataIndex: "judgment",
      width: 140,
      render: (text: string) => (
        <Tag color={getJudgmentColor(text)}>{text || "-"}</Tag>
      ),
    },
    {
      title: "红单数量",
      dataIndex: "red_qty",
      width: 110,
      render: (val: number) => (
        <span style={{ fontWeight: "bold" }}>{val ?? 0}</span>
      ),
    },
    {
      title: "海运数量",
      dataIndex: "sea_qty",
      width: 110,
      render: (val: number) => (
        <span style={{ fontWeight: "bold" }}>{val ?? 0}</span>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Title level={4}>分货计算测试</Title>

      <Card
        title="输入"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={loading}
              onClick={calculate}
            >
              计算分货
            </Button>
            <Button icon={<PlusOutlined />} onClick={addRow}>
              添加一行
            </Button>
          </Space>
        }
      >
        <Table<Row>
          columns={inputColumns}
          dataSource={rows}
          pagination={false}
          rowKey="key"
          size="small"
          locale={{ emptyText: "暂无数据，请点击「添加一行」" }}
        />
      </Card>

      <Card title="计算结果">
        <Table<Result>
          columns={resultColumns}
          dataSource={results}
          pagination={false}
          rowKey={(record, idx) =>
            `${record.asin || record.sku}-${record.country}-${idx ?? 0}`
          }
          size="small"
          loading={loading}
          locale={{ emptyText: "点击「计算分货」后展示结果" }}
        />
      </Card>
    </div>
  );
}
