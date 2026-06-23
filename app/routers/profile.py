"""个人档案路由模块。

提供身高等全局档案信息的查询与更新接口。
身高独立于每日体重记录存储, 用于在前端计算 BMI 等衍生指标。
request_id 由依赖项统一注入, 用于日志追踪。
"""

from fastapi import APIRouter, Depends
from loguru import logger

from app import profile_crud
from app.models import ProfileUpdate, TargetUpdate
from app.request_context import get_request_id

router = APIRouter(prefix="/api", tags=["profile"])


@router.get("/profile")
async def read_profile(request_id: str = Depends(get_request_id)) -> dict:
    """查询个人档案(当前身高)。

    Args:
        request_id: 由依赖项注入的请求唯一标识。

    Returns:
        统一响应结构, data 中包含 height_cm(未设置时为 None)。
    """
    logger.info("[{}] 查询个人档案", request_id)

    profile = await profile_crud.get_profile()

    return {
        "code": 200,
        "message": "查询成功",
        "request_id": request_id,
        "data": profile,
    }


@router.put("/profile")
async def update_profile(
    payload: ProfileUpdate,
    request_id: str = Depends(get_request_id),
) -> dict:
    """更新个人档案中的身高。

    Args:
        payload: 包含 height_cm 的请求体。
        request_id: 由依赖项注入的请求唯一标识。

    Returns:
        统一响应结构, data 中返回写入后的档案。
    """
    logger.info("[{}] 更新身高 height_cm={}", request_id, payload.height_cm)

    profile = await profile_crud.upsert_profile(payload.height_cm)

    return {
        "code": 200,
        "message": "身高保存成功",
        "request_id": request_id,
        "data": profile,
    }


@router.put("/profile/target")
async def update_target(
    payload: TargetUpdate,
    request_id: str = Depends(get_request_id),
) -> dict:
    """更新目标体重与起点日期。

    Args:
        payload: 包含 target_weight 与 target_start_date 的请求体。
        request_id: 由依赖项注入的请求唯一标识。

    Returns:
        统一响应结构, data 中返回写入后的目标信息。
    """
    logger.info(
        "[{}] 更新目标体重 target_weight={} start_date={}",
        request_id,
        payload.target_weight,
        payload.target_start_date,
    )

    target = await profile_crud.upsert_target(
        payload.target_weight, payload.target_start_date
    )

    return {
        "code": 200,
        "message": "目标体重保存成功",
        "request_id": request_id,
        "data": target,
    }
