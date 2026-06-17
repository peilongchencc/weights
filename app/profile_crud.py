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
        包含 height_cm 的字典; 尚未设置时 height_cm 为 None。
    """
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT height_cm FROM profile WHERE id = 1"
        )
        row = await cursor.fetchone()

    return {"height_cm": row["height_cm"] if row else None}


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
