from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

# 先只导入这些模块，看看会不会导致问题
try:
    from routers import inventory, reviews, dashboard, chat, auth
    print("路由模块导入成功")
except Exception as e:
    print(f"路由模块导入失败: {e}")
    import traceback
    traceback.print_exc()
    inventory = None
    reviews = None
    dashboard = None
    chat = None
    auth = None

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

# 先不注册路由，只注册健康检查
@app.get("/api/health")
async def health_check():
    """健康检查接口"""
    return {
        "status": "ok",
        "message": "宝鑫华盛AI助手服务运行正常",
        "version": "1.0.0"
    }

if __name__ == "__main__":
    print("启动调试后端服务...")
    import uvicorn
    uvicorn.run(
        "main_debug:app",
        host="0.0.0.0",
        port=8002,
        reload=False,
        log_level="info"
    )
