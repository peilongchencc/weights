"""个人档案数据访问模块。

封装对 profile 单行表的读取与写入。身高等全局信息不随日期变化,
故与每日体重记录(weight_records)分开存储。
"""

from datetime import datetime, timezone

from app.database import get_connection


def _now_iso() -> str:
    """返回当前 UTC 时间的 ISO8601 字符串。"""
    return datetime.now(timezone.utc).isoformat()


async def get_profile() -> dict:
    """读取个人档案。

    Returns:
        包含 height_cm / target_weight / target_start_date 的字典;
        对应项尚未设置时为 None。
    """
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT height_cm, target_weight, target_start_date "
            "FROM profile WHERE id = 1"
        )
        row = await cursor.fetchone()

    return {
        "height_cm": row["height_cm"] if row else None,
        "target_weight": row["target_weight"] if row else None,
        "target_start_date": row["target_start_date"] if row else None,
    }


async def upsert_profile(height_cm: float) -> dict:
    """新增或更新个人档案中的身高。

    首次写入时记录创建时间, 后续更新仅刷新更新时间。

    Args:
        height_cm: 身高(cm)。

    Returns:
        写入后的档案字典, 包含 height_cm。
    """
    now = _now_iso()
    async with get_connection() as conn:
        await conn.execute(
            """
            INSERT INTO profile (id, height_cm, created_at, updated_at)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                height_cm = excluded.height_cm,
                updated_at = excluded.updated_at
            """,
            (height_cm, now, now),
        )
        await conn.commit()

    return {"height_cm": height_cm}


async def upsert_target(target_weight: float, target_start_date: str) -> dict:
    """新增或更新目标体重与起点日期。

    与身高共用 profile 单行表, 但各字段独立写入: 仅更新目标相关列, 不影响
    已设置的身高。首次写入时记录创建时间, 后续更新仅刷新更新时间。

    Args:
        target_weight: 目标体重(kg)。
        target_start_date: 减重起点日期(yyyy-mm-dd), 用于定位起点的移动平均。

    Returns:
        写入后的目标字典, 包含 target_weight 与 target_start_date。
    """
    now = _now_iso()
    async with get_connection() as conn:
        await conn.execute(
            """
            INSERT INTO profile
                (id, target_weight, target_start_date, created_at, updated_at)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                target_weight = excluded.target_weight,
                target_start_date = excluded.target_start_date,
                updated_at = excluded.updated_at
            """,
            (target_weight, target_start_date, now, now),
        )
        await conn.commit()

    return {
        "target_weight": target_weight,
        "target_start_date": target_start_date,
    }
