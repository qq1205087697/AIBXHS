from sqlalchemy import Column, Integer, String, Enum, DateTime, Date, DECIMAL, Text, JSON, ForeignKey
from models.base import BaseModel
import enum


class PurchaseOrderStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    ORDERED = "ordered"
    PARTIAL_RECEIVED = "partial_received"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class InboundOrderStatus(str, enum.Enum):
    DRAFT = "draft"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"


class InboundType(str, enum.Enum):
    PURCHASE = "purchase"
    RETURN = "return"
    TRANSFER = "transfer"
    ADJUSTMENT = "adjustment"
    OTHER = "other"


class OutboundOrderStatus(str, enum.Enum):
    DRAFT = "draft"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"


class OutboundType(str, enum.Enum):
    SALE = "sale"
    RETURN_SUPPLIER = "return_supplier"
    TRANSFER = "transfer"
    SCRAP = "scrap"
    ADJUSTMENT = "adjustment"
    OTHER = "other"


class BatchStatus(str, enum.Enum):
    ACTIVE = "active"
    DEPLETED = "depleted"
    EXPIRED = "expired"
    FROZEN = "frozen"


class PurchaseOrder(BaseModel):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True, index=True, comment="采购订单ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    order_number = Column(String(50), nullable=False, comment="采购单号")
    supplier = Column(String(200), nullable=True, comment="供应商")
    contact_person = Column(String(100), nullable=True, comment="联系人")
    contact_phone = Column(String(50), nullable=True, comment="联系电话")
    warehouse = Column(String(100), nullable=True, comment="收货仓库")
    expected_date = Column(Date, nullable=True, comment="预计到货日期")
    total_amount = Column(DECIMAL(12, 2), default=0, comment="总金额")
    status = Column(Enum(PurchaseOrderStatus), default=PurchaseOrderStatus.DRAFT, comment="状态")
    notes = Column(Text, nullable=True, comment="备注")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="创建人")
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="审批人")
    approved_at = Column(DateTime, nullable=True, comment="审批时间")


class PurchaseOrderItem(BaseModel):
    __tablename__ = "purchase_order_items"

    id = Column(Integer, primary_key=True, index=True, comment="采购明细ID")
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False, index=True, comment="采购订单ID")
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True, comment="商品ID")
    quantity = Column(Integer, nullable=False, default=0, comment="采购数量")
    received_quantity = Column(Integer, nullable=False, default=0, comment="已收货数量")
    unit_price = Column(DECIMAL(12, 2), default=0, comment="采购单价")
    total_price = Column(DECIMAL(12, 2), default=0, comment="小计金额")
    notes = Column(Text, nullable=True, comment="备注")


class InboundOrder(BaseModel):
    __tablename__ = "inbound_orders"

    id = Column(Integer, primary_key=True, index=True, comment="入库订单ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    order_number = Column(String(50), nullable=False, comment="入库单号")
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True, index=True, comment="关联采购单ID")
    inbound_type = Column(Enum(InboundType), default=InboundType.PURCHASE, comment="入库类型")
    warehouse = Column(String(100), nullable=True, comment="收货仓库")
    handler = Column(String(100), nullable=True, comment="经办人")
    inbound_date = Column(DateTime, nullable=True, comment="入库日期")
    total_quantity = Column(Integer, nullable=False, default=0, comment="入库总数量")
    total_amount = Column(DECIMAL(12, 2), default=0, comment="入库总金额")
    status = Column(Enum(InboundOrderStatus), default=InboundOrderStatus.DRAFT, comment="状态")
    notes = Column(Text, nullable=True, comment="备注")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="创建人")
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="确认人")
    confirmed_at = Column(DateTime, nullable=True, comment="确认时间")


class InboundOrderItem(BaseModel):
    __tablename__ = "inbound_order_items"

    id = Column(Integer, primary_key=True, index=True, comment="入库明细ID")
    inbound_order_id = Column(Integer, ForeignKey("inbound_orders.id"), nullable=False, index=True, comment="入库订单ID")
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True, comment="商品ID")
    quantity = Column(Integer, nullable=False, default=0, comment="入库数量")
    unit_price = Column(DECIMAL(12, 2), default=0, comment="采购单价")
    total_price = Column(DECIMAL(12, 2), default=0, comment="小计金额")
    batch_number = Column(String(50), nullable=True, comment="批次号")
    production_date = Column(Date, nullable=True, comment="生产日期")
    expiry_date = Column(Date, nullable=True, comment="过期日期")
    warehouse = Column(String(100), nullable=True, comment="存放仓库")
    notes = Column(Text, nullable=True, comment="备注")


class InventoryBatch(BaseModel):
    __tablename__ = "inventory_batches"

    id = Column(Integer, primary_key=True, index=True, comment="批次ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True, comment="商品ID")
    inbound_order_id = Column(Integer, ForeignKey("inbound_orders.id"), nullable=True, comment="关联入库单ID")
    inbound_item_id = Column(Integer, ForeignKey("inbound_order_items.id"), nullable=True, comment="关联入库明细ID")
    stock_transfer_order_id = Column(Integer, ForeignKey("stock_transfer_orders.id"), nullable=True, comment="关联挪货单ID")
    stock_transfer_item_id = Column(Integer, ForeignKey("stock_transfer_order_items.id"), nullable=True, comment="关联挪货明细ID")
    batch_number = Column(String(50), nullable=False, comment="批次号")
    initial_quantity = Column(Integer, nullable=False, comment="初始数量")
    current_quantity = Column(Integer, nullable=False, default=0, comment="当前剩余数量")
    locked_quantity = Column(Integer, nullable=False, default=0, comment="锁定数量")
    unit_price = Column(DECIMAL(12, 2), default=0, comment="采购单价")
    warehouse = Column(String(100), nullable=True, comment="存放仓库")
    shelf_number = Column(String(100), nullable=True, comment="货架号")
    inbound_date = Column(DateTime, nullable=True, comment="入库日期")
    production_date = Column(Date, nullable=True, comment="生产日期")
    expiry_date = Column(Date, nullable=True, comment="过期日期")
    status = Column(Enum(BatchStatus), default=BatchStatus.ACTIVE, comment="批次状态")
    notes = Column(Text, nullable=True, comment="备注")


class OutboundOrder(BaseModel):
    __tablename__ = "outbound_orders"

    id = Column(Integer, primary_key=True, index=True, comment="出库订单ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    order_number = Column(String(50), nullable=False, comment="出库单号")
    outbound_type = Column(Enum(OutboundType), default=OutboundType.OTHER, comment="出库类型")
    warehouse = Column(String(100), nullable=True, comment="发货仓库")
    handler = Column(String(100), nullable=True, comment="经办人")
    outbound_date = Column(DateTime, nullable=True, comment="出库日期")
    total_quantity = Column(Integer, nullable=False, default=0, comment="出库总数量")
    total_amount = Column(DECIMAL(12, 2), default=0, comment="出库总金额")
    status = Column(Enum(OutboundOrderStatus), default=OutboundOrderStatus.DRAFT, comment="状态")
    notes = Column(Text, nullable=True, comment="备注")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="创建人")
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="确认人")
    confirmed_at = Column(DateTime, nullable=True, comment="确认时间")


class OutboundOrderItem(BaseModel):
    __tablename__ = "outbound_order_items"

    id = Column(Integer, primary_key=True, index=True, comment="出库明细ID")
    outbound_order_id = Column(Integer, ForeignKey("outbound_orders.id"), nullable=False, index=True, comment="出库订单ID")
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True, comment="商品ID")
    batch_id = Column(Integer, ForeignKey("inventory_batches.id"), nullable=True, comment="扣减批次ID")
    batch_number = Column(String(50), nullable=True, comment="批次号")
    batch_details = Column(JSON, nullable=True, comment="跨批次扣减明细")
    quantity = Column(Integer, nullable=False, default=0, comment="出库数量")
    unit_price = Column(DECIMAL(12, 2), default=0, comment="出库单价")
    total_price = Column(DECIMAL(12, 2), default=0, comment="小计金额")
    notes = Column(Text, nullable=True, comment="备注")


class StockTransferOrderStatus(str, enum.Enum):
    DRAFT = "draft"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"


class StockTransferOrder(BaseModel):
    __tablename__ = "stock_transfer_orders"

    id = Column(Integer, primary_key=True, index=True, comment="挪货申请ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    order_number = Column(String(50), nullable=False, comment="挪货单号")
    source_warehouse = Column(String(100), nullable=False, comment="源仓库")
    target_warehouse = Column(String(100), nullable=False, comment="目标仓库")
    total_quantity = Column(Integer, nullable=False, default=0, comment="总数量")
    total_amount = Column(DECIMAL(12, 2), default=0, comment="总金额")
    status = Column(Enum(StockTransferOrderStatus), default=StockTransferOrderStatus.DRAFT, comment="状态")
    notes = Column(Text, nullable=True, comment="备注")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="创建人")
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="审批人")
    confirmed_at = Column(DateTime, nullable=True, comment="审批时间")


class StockTransferOrderItem(BaseModel):
    __tablename__ = "stock_transfer_order_items"

    id = Column(Integer, primary_key=True, index=True, comment="明细ID")
    stock_transfer_order_id = Column(Integer, ForeignKey("stock_transfer_orders.id"), nullable=False, index=True, comment="挪货申请ID")
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True, comment="商品ID")
    batch_id = Column(Integer, ForeignKey("inventory_batches.id"), nullable=True, comment="库存批次ID")
    batch_number = Column(String(50), nullable=True, comment="批次号")
    shelf_number = Column(String(100), nullable=True, comment="当前货架号")
    target_shelf_number = Column(String(100), nullable=True, comment="目标货架号")
    quantity = Column(Integer, nullable=False, default=0, comment="数量")
    unit_price = Column(DECIMAL(12, 2), default=0, comment="单价")
    total_price = Column(DECIMAL(12, 2), default=0, comment="小计金额")
    notes = Column(Text, nullable=True, comment="备注")


class OperationLog(BaseModel):
    __tablename__ = "operation_logs"

    id = Column(Integer, primary_key=True, index=True, comment="日志ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, comment="操作用户ID")
    username = Column(String(100), nullable=True, comment="操作用户名")
    module = Column(String(50), nullable=False, comment="操作模块")
    action = Column(String(50), nullable=False, comment="操作类型")
    target_type = Column(String(50), nullable=True, comment="目标类型")
    target_id = Column(Integer, nullable=True, comment="目标ID")
    target_name = Column(String(255), nullable=True, comment="目标名称")
    before_data = Column(JSON, nullable=True, comment="操作前数据")
    after_data = Column(JSON, nullable=True, comment="操作后数据")
    summary = Column(String(500), nullable=True, comment="操作摘要")
    ip_address = Column(String(50), nullable=True, comment="IP地址")


class WarehouseStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class Warehouse(BaseModel):
    __tablename__ = "warehouses"

    id = Column(Integer, primary_key=True, index=True, comment="仓库ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    name = Column(String(100), nullable=False, comment="仓库名称")
    code = Column(String(50), nullable=False, comment="仓库编码")
    address = Column(String(300), nullable=True, comment="仓库地址")
    contact_person = Column(String(100), nullable=True, comment="联系人")
    contact_phone = Column(String(50), nullable=True, comment="联系电话")
    status = Column(Enum(WarehouseStatus), default=WarehouseStatus.ACTIVE, comment="状态")
    notes = Column(Text, nullable=True, comment="备注")