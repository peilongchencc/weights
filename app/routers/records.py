"""体重记录路由模块。

提供体重记录的录入、查询(含移动平均)与删除接口。
request_id 由依赖项统一注入, 用于日志追踪。
"""

from fastapi import APIRouter, Depends
from loguru import logger

from app import crud
from app.config import MA_WINDOWS, TARGET_BAND
from app.models import WeightCreate
from app.moving_average import attach_moving_averages
from app.request_context import get_request_id

router = APIRouter(prefix="/api", tags=["records"])


@router.post("/records")
async def create_record(
    payload: WeightCreate,
    request_id: str = Depends(get_request_id),
) -> dict:
    """新增或更新一条体重记录(同一天覆盖)。

    Args:
        payload: 包含 weight(必填) / note(可选) / date 的请求体。
        request_id: 由依赖项注入的请求唯一标识。

    Returns:
        统一响应结构, data 中返回写入的记录。
    """
    logger.info(
        "[{}] 录入体重记录 date={} weight={} note={}",
        request_id,
        payload.date,
        payload.weight,
        payload.note,
    )

    record = await crud.upsert_record(payload.date, payload.weight, payload.note)

    return {
        "code": 200,
        "message": "记录保存成功",
        "request_id": request_id,
        "data": record,
    }


@router.get("/records")
async def get_records(request_id: str = Depends(get_request_id)) -> dict:
    """查询全部体重记录并附加移动平均值。

    Args:
        request_id: 由依赖项注入的请求唯一标识。

    Returns:
        统一响应结构, data 中包含记录列表与所用移动平均窗口。
    """
    logger.info("[{}] 查询体重记录列表", request_id)

    records = await crud.list_records()
    enhanced = attach_moving_averages(records, MA_WINDOWS)

    return {
        "code": 200,
        "message": "查询成功",
        "request_id": request_id,
        "data": {
            "windows": MA_WINDOWS,
            "target_band": TARGET_BAND,
            "records": enhanced,
        },
    }


@router.delete("/records/{date}")
async def remove_record(
    date: str,
    request_id: str = Depends(get_request_id),
) -> dict:
    """删除指定日期的体重记录。

    Args:
        date: 记录日期, 格式 yyyy-mm-dd。
        request_id: 由依赖项注入的请求唯一标识。

    Returns:
        统一响应结构, data 中返回是否删除成功。
    """
    logger.info("[{}] 删除体重记录 date={}", request_id, date)

    deleted = await crud.delete_record(date)

    return {
        "code": 200 if deleted else 404,
        "message": "删除成功" if deleted else "未找到对应日期的记录",
        "request_id": request_id,
        "data": {"deleted": deleted},
    }
