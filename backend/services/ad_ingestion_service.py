"""
影刀 RPA 数据推送服务
数据来源: 影刀 RPA 从星拓 ERP 下载报表后推送至本系统
功能: 批量 upsert 广告日度数据到 4 个日度分表
"""
import logging
from database.database import SessionLocal
from models.ad_daily import (
    AdCampaignDaily,
    AdKeywordDaily,
    AdSearchTermDaily,
    AdProductDaily,
)

logger = logging.getLogger(__name__)


class AdIngestionService:
    """广告日度数据批量导入服务

    供影刀 RPA 调用，将采集到的广告报表数据批量 upsert 到对应日度分表。
    每个方法接收 records（dict 列表），每个 dict 包含日表模型的字段名和值。
    """

    BATCH_SIZE = 500

    # ==================== 公开方法 ====================

    def batch_upsert_campaigns(self, db, tenant_id, records):
        """批量 upsert 活动日数据到 AdCampaignDaily

        unique_keys: tenant_id + date + campaign_id
        """
        return self._batch_upsert(
            db,
            AdCampaignDaily,
            tenant_id,
            records,
            unique_keys=['tenant_id', 'date', 'campaign_id'],
        )

    def batch_upsert_keywords(self, db, tenant_id, records):
        """批量 upsert 关键词日数据到 AdKeywordDaily

        unique_keys: tenant_id + date + keyword_id
        """
        return self._batch_upsert(
            db,
            AdKeywordDaily,
            tenant_id,
            records,
            unique_keys=['tenant_id', 'date', 'keyword_id'],
        )

    def batch_upsert_search_terms(self, db, tenant_id, records):
        """批量 upsert 搜索词日数据到 AdSearchTermDaily

        unique_keys: tenant_id + date + search_term
        """
        return self._batch_upsert(
            db,
            AdSearchTermDaily,
            tenant_id,
            records,
            unique_keys=['tenant_id', 'date', 'search_term'],
        )

    def batch_upsert_products(self, db, tenant_id, records):
        """批量 upsert 产品日数据到 AdProductDaily

        unique_keys: tenant_id + date + ad_id
        """
        return self._batch_upsert(
            db,
            AdProductDaily,
            tenant_id,
            records,
            unique_keys=['tenant_id', 'date', 'ad_id'],
        )

    # ==================== 核心通用方法 ====================

    def _batch_upsert(self, db, model, tenant_id, records, unique_keys):
        """通用批量 upsert

        Args:
            db: SQLAlchemy Session
            model: 日表模型类（AdCampaignDaily / AdKeywordDaily / ...）
            tenant_id: 租户ID
            records: dict 列表，每个 dict 包含模型字段名和值
            unique_keys: 用于判断 upsert 的字段组合，如 ['tenant_id', 'date', 'campaign_id']

        Returns:
            dict: {'total': 总数, 'inserted': 插入数, 'updated': 更新数, 'failed': 失败数}
        """
        if not records:
            logger.info(f"({model.__tablename__}) 无数据需要处理")
            return {'total': 0, 'inserted': 0, 'updated': 0, 'failed': 0}

        total = len(records)
        inserted = 0
        updated = 0
        failed = 0

        logger.info(
            f"({model.__tablename__}) 开始批量 upsert: 共 {total} 条记录, "
            f"batch_size={self.BATCH_SIZE}, unique_keys={unique_keys}"
        )

        try:
            for i in range(0, total, self.BATCH_SIZE):
                batch = records[i:i + self.BATCH_SIZE]
                batch_num = i // self.BATCH_SIZE + 1

                for record in batch:
                    try:
                        # 使用 savepoint（嵌套事务）确保单条失败不影响整批
                        with db.begin_nested():
                            result = self._upsert_single(db, model, tenant_id, record, unique_keys)
                        if result == 'inserted':
                            inserted += 1
                        elif result == 'updated':
                            updated += 1
                    except Exception as record_err:
                        failed += 1
                        logger.error(
                            f"({model.__tablename__}) upsert 记录失败: {record_err}, "
                            f"record: {record}"
                        )
                        # savepoint 已自动回滚，外层事务仍可用，继续处理下一条

                # 每批提交事务
                try:
                    db.commit()
                except Exception as commit_err:
                    logger.error(
                        f"({model.__tablename__}) 批次 {batch_num} 提交失败: {commit_err}"
                    )
                    db.rollback()
                    raise

                processed = min(i + self.BATCH_SIZE, total)
                logger.info(
                    f"({model.__tablename__}) 批次 {batch_num} 完成: "
                    f"已处理 {processed}/{total} (插入: {inserted}, 更新: {updated}, 失败: {failed})"
                )

            logger.info(
                f"({model.__tablename__}) 批量 upsert 完成: "
                f"总计 {total}, 插入 {inserted}, 更新 {updated}, 失败 {failed}"
            )

        except Exception as e:
            logger.error(f"({model.__tablename__}) 批量 upsert 异常: {e}")
            db.rollback()
            raise

        return {
            'total': total,
            'inserted': inserted,
            'updated': updated,
            'failed': failed,
        }

    def _upsert_single(self, db, model, tenant_id, record, unique_keys):
        """单条记录 upsert

        根据 unique_keys 查询已有记录，存在则更新，不存在则插入。
        调用方应使用 db.begin_nested() 包裹此方法以实现单条失败隔离。

        Returns:
            str: 'inserted' 或 'updated'
        """
        # 构建查询条件
        filters = [model.tenant_id == tenant_id]
        for key in unique_keys:
            if key == 'tenant_id':
                continue  # tenant_id 已在外部传入
            if key not in record:
                raise ValueError(f"记录缺少唯一键字段: {key}, record: {record}")
            filters.append(getattr(model, key) == record[key])

        # 查询已有记录
        existing = db.query(model).filter(*filters).first()

        if existing:
            # 更新已有记录（跳过唯一键字段，避免无意义赋值）
            for key, value in record.items():
                if key in unique_keys:
                    continue
                if hasattr(existing, key) and value is not None:
                    setattr(existing, key, value)
            return 'updated'
        else:
            # 插入新记录
            insert_data = dict(record)  # 复制一份，避免修改原始数据
            insert_data['tenant_id'] = tenant_id
            new_record = model(**insert_data)
            db.add(new_record)
            return 'inserted'
