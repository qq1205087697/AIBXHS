import sys
import io
import logging

# 设置输出编码为 UTF-8，避免 Windows 上的编码问题
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# 配置日志
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from routers import inventory, reviews, dashboard, chat, auth
from config import get_settings

settings = get_settings()

app = FastAPI(
    title="宝鑫华盛AI助手",
    description="跨境电商AI运营平台后端API",
    version="1.0.0"
)

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(inventory.router, prefix="/api")
app.include_router(reviews.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(chat.router)
app.include_router(auth.router)

@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "message": "宝鑫华盛AI助手服务运行正常",
        "version": "1.0.0"
    }

@app.on_event("startup")
async def startup_event():
    """应用启动事件"""
    logger.info("宝鑫华盛AI助手后端服务启动中...")
    try:
        from database.database import init_db
        init_db()
        logger.info("数据库初始化完成")
    except Exception as e:
        logger.error(f"数据库初始化失败: {e}")
        logger.info("使用现有数据库表结构")
    
    try:
        from services.scheduler import init_scheduler
        init_scheduler()
        logger.info("定时任务调度器已启动")
    except Exception as e:
        logger.error(f"定时任务调度器启动失败: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭事件"""
    logger.info("服务已关闭")

@app.get("/")
async def root():
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    index_path = os.path.join(static_dir, "index.html")
    
    if os.path.exists(index_path):
        return FileResponse(index_path)
    
    return {
        "message": "欢迎使用宝鑫华盛AI助手API",
        "docs": "/docs",
        "health": "/api/health"
    }

static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8002,
        reload=False,
        log_level="debug"
    )
