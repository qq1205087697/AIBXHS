from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

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

@app.get("/api/health")
async def health_check():
    """健康检查接口"""
    return {
        "status": "ok",
        "message": "宝鑫华盛AI助手服务运行正常",
        "version": "1.0.0"
    }

if __name__ == "__main__":
    print("启动简化后端服务...")
    import uvicorn
    uvicorn.run(
        "main_simple:app",
        host="0.0.0.0",
        port=8001,
        reload=False,
        log_level="info"
    )
