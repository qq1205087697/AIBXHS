"""
Excel 文件读取工具
提供安全读取 Excel 的方法，自动修复常见的 xlsx XML 损坏问题
"""
import io
import logging
import re
import zipfile

import pandas as pd

logger = logging.getLogger(__name__)


def repair_xlsx_filter(file_content: bytes) -> bytes:
    """
    修复 xlsx 文件中无效的 autoFilter XML。

    某些 Excel 文件（尤其是 RPA/影刀生成的）包含格式错误的 autoFilter 引用，
    导致 openpyxl 抛出 "Value does not match pattern" 错误。

    此函数解压 xlsx，移除无效的 filter 元素后重新打包。
    """
    try:
        zip_in = zipfile.ZipFile(io.BytesIO(file_content), 'r')
        output_buf = io.BytesIO()
        zip_out = zipfile.ZipFile(output_buf, 'w', zipfile.ZIP_DEFLATED)

        fixed = False
        for item in zip_in.infolist():
            data = zip_in.read(item.filename)
            # 只处理 worksheet XML
            if item.filename.startswith('xl/worksheets/'):
                text = data.decode('utf-8')
                original = text
                # 移除自闭合的 autoFilter 标签
                text = re.sub(r'<autoFilter[^>]*/>', '', text)
                # 移除成对的 autoFilter 标签及其内容
                text = re.sub(r'<autoFilter[^>]*>.*?</autoFilter>', '', text, flags=re.DOTALL)
                # 移除 filterColumns 元素
                text = re.sub(r'<filterColumns>.*?</filterColumns>', '', text, flags=re.DOTALL)
                if text != original:
                    fixed = True
                data = text.encode('utf-8')
            zip_out.writestr(item, data)

        zip_in.close()
        zip_out.close()

        if fixed:
            logger.info("xlsx autoFilter XML 已修复")
        return output_buf.getvalue()
    except Exception as e:
        logger.warning(f"xlsx 修复失败，返回原始内容: {e}")
        return file_content


def safe_read_excel(file_content: bytes, **kwargs) -> pd.DataFrame:
    """
    安全读取 Excel：先尝试直接读取，失败则修复 autoFilter XML 后重试。

    自动处理以下错误:
    - "Unable to read workbook" (autoFilter XML 格式错误)
    - "Value does not match pattern" (filter reference 格式错误)

    用法与 pd.read_excel 一致，传入 file_content (bytes) 替代文件路径:
        df = safe_read_excel(file_content, engine='openpyxl')
        df = safe_read_excel(file_content, header=1)
    """
    try:
        return pd.read_excel(io.BytesIO(file_content), **kwargs)
    except Exception as e:
        err_msg = str(e)
        if "Unable to read workbook" in err_msg or "does not match pattern" in err_msg:
            logger.warning(f"Excel 读取失败(autoFilter 问题)，尝试修复后重读: {e}")
            fixed_content = repair_xlsx_filter(file_content)
            return pd.read_excel(io.BytesIO(fixed_content), **kwargs)
        raise
