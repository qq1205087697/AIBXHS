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

# 健康检查
@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "message": "宝鑫华盛AI助手服务运行正常",
        "version": "1.0.0"
    }

# 逐步导入路由并测试
print("开始导入路由...")
try:
    from routers import reviews
    print("reviews路由导入成功")
    app.include_router(reviews.router, prefix="/api")
    print("reviews路由注册成功")
except Exception as e:
    print(f"reviews路由导入失败: {e}")
    import traceback
    traceback.print_exc()

if __name__ == "__main__":
    print("启动调试后端服务...")
    import uvicorn
    uvicorn.run(
        "main_debug2:app",
        host="0.0.0.0",
        port=8002,
        reload=False,
        log_level="info"
    )
