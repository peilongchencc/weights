"""请求上下文模块。

统一为每个请求生成 request_id, 用于日志追踪与异常排查:
    - 中间件在请求进入时生成 request_id, 写入 request.state 并回填到响应头;
    - 依赖项供路由直接获取该 request_id, 避免在每个接口重复生成;
    - 全局异常处理器复用同一 request_id, 保证出错响应仍可追踪。
"""

import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware

# 响应头中携带 request_id 的字段名
REQUEST_ID_HEADER = "X-Request-ID"


class RequestIDMiddleware(BaseHTTPMiddleware):
    """为每个请求分配唯一 request_id 的中间件。

    生成的 request_id 同时写入 request.state 与响应头, 便于客户端与服务端日志对齐。
    """

    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = request_id
        return response


def get_request_id(request: Request) -> str:
    """依赖项: 返回当前请求的 request_id。

    Args:
        request: 当前请求对象。

    Returns:
        中间件预先写入的 request_id; 缺失时兜底生成一个新值。
    """
    return getattr(request.state, "request_id", None) or str(uuid.uuid4())


def register_exception_handler(app: FastAPI) -> None:
    """为应用注册全局异常处理器。

    捕获未被显式处理的异常, 返回符合统一结构且携带 request_id 的响应,
    确保出错时日志追踪链不中断。

    Args:
        app: FastAPI 应用实例。
    """

    @app.exception_handler(Exception)
    async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        request_id = get_request_id(request)
        logger.exception("[{}] 未处理异常: {}", request_id, exc)
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": "服务器内部错误",
                "request_id": request_id,
                "data": None,
            },
        )
