"""放纵记录路由模块。

提供"喝酒/吃好吃的"等放纵行为的录入(一天一条, 同日覆盖)、查询、编辑与
删除接口, 帮助用户回看触发原因(压力/奖励)并据此提醒自己。request_id 由
依赖项统一注入, 用于日志追踪。

注: "已坚持 N 天"等衍生指标由前端按最新记录日期计算, 后端只负责存取。
"""

from fastapi import APIRouter, Depends
from loguru import logger

from app import indulgence_crud
from app.models import IndulgenceCreate, IndulgenceUpdate
from app.request_context import get_request_id

router = APIRouter(prefix="/api", tags=["indulgences"])


@router.post("/indulgences")
async def create_indulgence(
    payload: IndulgenceCreate,
    request_id: str = Depends(get_request_id),
) -> dict:
    """新增或更新某一天的放纵记录(一天一条, 同日覆盖)。

    Args:
        payload: 含 kinds / trigger / note / date 的请求体。
        request_id: 由依赖项注入的请求唯一标识。

    Returns:
        统一响应结构, data 中返回写入的记录(含 id)。
    """
    logger.info(
        "[{}] 录入放纵记录 date={} kinds={} trigger={} note={}",
        request_id,
        payload.date,
        payload.kinds,
        payload.trigger,
        payload.note,
    )

    record = await indulgence_crud.upsert_indulgence(
        payload.date, payload.kinds, payload.trigger, payload.note
    )

    return {
        "code": 200,
        "message": "放纵记录已保存",
        "request_id": request_id,
        "data": record,
    }


@router.put("/indulgences/{indulgence_id}")
async def edit_indulgence(
    indulgence_id: int,
    payload: IndulgenceUpdate,
    request_id: str = Depends(get_request_id),
) -> dict:
    """编辑指定 id 的放纵记录(类型 / 触发原因 / 备注, 日期不变)。

    Args:
        indulgence_id: 记录的自增主键。
        payload: 含 kinds / trigger / note 的请求体。
        request_id: 由依赖项注入的请求唯一标识。

    Returns:
        统一响应结构, data 中返回更新后的记录; 未找到时 code 为 404。
    """
    logger.info(
        "[{}] 编辑放纵记录 id={} kinds={} trigger={} note={}",
        request_id,
        indulgence_id,
        payload.kinds,
        payload.trigger,
        payload.note,
    )

    record = await indulgence_crud.update_indulgence(
        indulgence_id, payload.kinds, payload.trigger, payload.note
    )

    return {
        "code": 200 if record else 404,
        "message": "放纵记录已更新" if record else "未找到对应的放纵记录",
        "request_id": request_id,
        "data": record,
    }


@router.get("/indulgences")
async def get_indulgences(request_id: str = Depends(get_request_id)) -> dict:
    """查询全部放纵记录(最新在前)。

    Args:
        request_id: 由依赖项注入的请求唯一标识。

    Returns:
        统一响应结构, data 中包含记录列表。
    """
    logger.info("[{}] 查询放纵记录列表", request_id)

    records = await indulgence_crud.list_indulgences()

    return {
        "code": 200,
        "message": "查询成功",
        "request_id": request_id,
        "data": {"records": records},
    }


@router.delete("/indulgences/{indulgence_id}")
async def remove_indulgence(
    indulgence_id: int,
    request_id: str = Depends(get_request_id),
) -> dict:
    """删除指定 id 的放纵记录。

    Args:
        indulgence_id: 记录的自增主键。
        request_id: 由依赖项注入的请求唯一标识。

    Returns:
        统一响应结构, data 中返回是否删除成功。
    """
    logger.info("[{}] 删除放纵记录 id={}", request_id, indulgence_id)

    deleted = await indulgence_crud.delete_indulgence(indulgence_id)

    return {
        "code": 200 if deleted else 404,
        "message": "删除成功" if deleted else "未找到对应的放纵记录",
        "request_id": request_id,
        "data": {"deleted": deleted},
    }
