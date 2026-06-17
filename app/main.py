"""FastAPI 应用主入口。

负责装配日志、生命周期、路由与静态前端页面。
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.config import BASE_DIR, HOST, LOG_PATH, PORT, RELOAD
from app.database import init_db
from app.request_context import RequestIDMiddleware, register_exception_handler
from app.routers import profile, records

# 配置 loguru 日志输出到文件(滚动 + 保留)
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
logger.add(LOG_PATH, rotation="10 MB", retention="30 days", encoding="utf-8")

STATIC_DIR = BASE_DIR / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期: 启动时初始化数据库。"""
    await init_db()
    logger.info("数据库初始化完成, 服务启动")
    yield
    logger.info("服务关闭")


app = FastAPI(title="每日体重记录", lifespan=lifespan)
app.add_middleware(RequestIDMiddleware)
register_exception_handler(app)
app.include_router(records.router)
app.include_router(profile.router)


@app.get("/")
async def index() -> FileResponse:
    """返回前端首页。"""
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=RELOAD)
