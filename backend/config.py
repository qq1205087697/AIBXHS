from pydantic_settings import BaseSettings
from functools import lru_cache
import urllib.parse
import os


class Settings(BaseSettings):
    """应用配置"""
    PORT: int = 8000
    
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASSWORD: str = "Root@123456"
    DB_NAME: str = "baoxinhuasheng"

    # Demo 模式配置
    DEMO_MODE: bool = False
    DEMO_DB_HOST: str = "localhost"
    DEMO_DB_PORT: int = 3306
    DEMO_DB_USER: str = "root"
    DEMO_DB_PASSWORD: str = "123456"
    DEMO_DB_NAME: str = "bxhs_ai_assistance_demo"
    
    FEISHU_APP_ID: str = ""
    FEISHU_APP_SECRET: str = ""
    FEISHU_INVENTORY_BASE_TOKEN: str = ""
    FEISHU_INVENTORY_TABLE_ID: str = ""
    FEISHU_REVIEW_BASE_TOKEN: str = ""
    FEISHU_REVIEW_TABLE_ID: str = ""
    # 开发机器人：新品多维表（回传/美工图片附件）
    FEISHU_DESIGN_BASE_TOKEN: str = ""
    FEISHU_DESIGN_TABLE_ID: str = ""
    # 飞书多维表同步服务（独立应用 + 数据表）
    FEISHU_SYNC_APP_ID: str = ""
    FEISHU_SYNC_APP_SECRET: str = ""
    FEISHU_SYNC_BASE_TOKEN: str = ""
    FEISHU_SYNC_TABLE_ID: str = ""
    # 飞书 webhook - 邮件机器人自动化
    FEISHU_EMAIL_WEBHOOK_URL: str = ""
    # 飞书 webhook - 产品页信息自动化
    FEISHU_PAGE_INFO_WEBHOOK_URL: str = ""
    # 飞书 webhook - 开广告提交地址
    FEISHU_AD_WEBHOOK_URL: str = ""
    # 美工图片 TOS 自动迁移开关（false 关闭启动时自动迁移）
    DESIGNER_IMAGE_AUTO_MIGRATE: str = "true"
    # 飞书 webhook - 编辑基础信息提交地址
    FEISHU_EDIT_WEBHOOK_URL: str = ""
    # 飞书 webhook - 一键优化提交地址
    FEISHU_OPTIMIZE_WEBHOOK_URL: str = ""
    
    OPENAI_API_KEY: str = ""
    OPENAI_API_BASE: str = "https://yunwu.ai/v1"
    OPENAI_MODEL: str = "deepseek-v4-flash"
    # AI 调用参数（可按需在 .env 调整）
    OPENAI_TEMPERATURE: float = 0.7
    OPENAI_TIMEOUT: int = 60
    OPENAI_VISION_MODEL: str = ""
    OPENAI_VISION_RESPONSE_FORMAT: str = ""

    # MiniMax H3 本地视频生成（ComfyUI API，需 Basic Auth 账号密码）
    
    H3_BASE_URL: str = ""
    H3_AUTH_USER: str = ""
    H3_AUTH_PASSWORD: str = ""
    # 工作流模板默认取工程内文件（跨平台部署可用），需要时用环境变量 H3_WORKFLOW_PATH 覆盖
    H3_WORKFLOW_PATH: str = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "workflows", "h3_workflow_template.json"
    )
    H3_POLL_INTERVAL: int = 15          # 轮询任务状态间隔（秒）
    H3_MAX_WAIT_MINUTES: int = 240      # 单条视频最长等待时间（分钟）

    # 视频超分（Topaz 星光 2.6）工作流模板，与 H3 共用同一台 ComfyUI
    UPSCALE_WORKFLOW_PATH: str = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "workflows", "upscale_workflow_template.json"
    )

    # H3 提示词二次优化：按官方 h3-prompt-writing 指南把中文方案改写为 Ref2VA 六段式英文提示词
    H3_PROMPT_OPTIMIZE: bool = True     # 关闭后直接提交原始方案文本
    H3_PROMPT_MODEL: str = ""           # 优化用文本模型，留空则使用 OPENAI_MODEL
    H3_PROMPT_GUIDE_DIR: str = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "prompts"
    )

    # AI 商品套图（Qwen-Image-2.1 图生图，与 H3 共用同一台 ComfyUI，Basic Auth 复用 H3_*）
    IMAGE_WORKFLOW_PATH: str = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "workflows", "qwen_image_workflow.json"
    )
    IMAGE_PROMPT_TEMPLATES_PATH: str = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "prompts", "image_prompt_templates.json"
    )
    IMAGE_POLL_INTERVAL: int = 5        # 轮询生成进度间隔（秒），图片耗时短于视频
    IMAGE_MAX_WAIT_MINUTES: int = 30    # 单任务最长等待时间（分钟），PE 首载 GGUF 可能 1~3 分钟
    IMAGE_MAX_CONCURRENT_TASKS: int = 2 # 单实例同时轮询的最大任务数（ComfyUI 串行队列，与生视频互让）

    # 火山引擎 TOS 对象存储配置
    # 获取方式：
    # 1. AK/SK: 在火山引擎控制台「访问密钥」中创建
    #    https://console.volcengine.com/iam/keymanage/
    # 2. Endpoint/Region/Bucket: 在 TOS 控制台创建桶后获取
    #    https://console.volcengine.com/tos
    TOS_ACCESS_KEY: str = ""
    TOS_SECRET_KEY: str = ""
    TOS_ENDPOINT: str = ""            # 如: tos-cn-beijing.volces.com
    TOS_REGION: str = ""              # 如: cn-beijing
    TOS_BUCKET: str = ""              # 桶名称
    TOS_PREFIX: str = "uploads/"     # 对象前缀（目录）
    # 桶访问域名（用于拼接公网访问URL，若为空则使用 https://{bucket}.{endpoint} 形式）
    TOS_CUSTOM_DOMAIN: str = ""

    # JWT配置
    SECRET_KEY: str = "your-secret-key-change-this-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    # 星拓 MCP Server（标签系统 R2 数据源；密钥资产，不入代码库）
    STARTOP_MCP_URL: str = "https://openmcp.startop.com/mcp-servers/startop-mcp"
    STARTOP_MCP_KEY: str = ""         # X-Mcp-Key，星拓后台申请
    STARTOP_PULL_HOUR: int = 2        # 每日定时拉取时刻（Q-3 裁决：每日定时独立拉取，可配置）
    STARTOP_PAGE_SIZE: int = 100      # 搜索词报表分页大小
    
    @property
    def DATABASE_URL(self) -> str:
        """构建数据库连接URL，DEMO_MODE=true 时连接本地 Demo 库"""
        if self.DEMO_MODE:
            host = self.DEMO_DB_HOST
            port = self.DEMO_DB_PORT
            user = self.DEMO_DB_USER
            pwd = self.DEMO_DB_PASSWORD
            db = self.DEMO_DB_NAME
        else:
            host = self.DB_HOST
            port = self.DB_PORT
            user = self.DB_USER
            pwd = self.DB_PASSWORD
            db = self.DB_NAME
        encoded_password = urllib.parse.quote_plus(pwd)
        return f"mysql+pymysql://{user}:{encoded_password}@{host}:{port}/{db}?charset=utf8mb4"
    
    model_config = {
        "env_file": [
            os.path.join(os.path.dirname(__file__), ".env"),
            os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"),
        ],
        "env_file_encoding": "utf-8",
    }


def get_settings() -> Settings:
    return Settings()
