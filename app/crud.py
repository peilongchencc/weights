"""数据访问模块。

封装对 weight_records 表的增删改查操作。
"""

from datetime import datetime, timezone

from app.database import get_connection


def _now_iso() -> str:
    """返回当前 UTC 时间的 ISO8601 字符串。"""
    return datetime.now(timezone.utc).isoformat()


async def upsert_record(date: str, weight: float, note: str | None) -> dict:
    """新增或更新某一天的体重记录。

    同一天再次提交时执行更新(覆盖), 保留首次创建时间。

    Args:
        date: 记录日期, 格式 yyyy-mm-dd。
        weight: 体重(kg)。
        note: 备注, 可为 None。

    Returns:
        写入后的记录字典。
    """
    now = _now_iso()
    async with get_connection() as conn:
        await conn.execute(
            """
            INSERT INTO weight_records (date, weight, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                weight = excluded.weight,
                note = excluded.note,
                updated_at = excluded.updated_at
            """,
            (date, weight, note, now, now),
        )
        await conn.commit()

    return {"date": date, "weight": weight, "note": note}


async def list_records() -> list[dict]:
    """查询全部体重记录, 按日期升序返回。

    Returns:
        记录字典列表, 字段包含 date / weight / note。
    """
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT date, weight, note FROM weight_records ORDER BY date ASC"
        )
        rows = await cursor.fetchall()

    return [
        {"date": row["date"], "weight": row["weight"], "note": row["note"]}
        for row in rows
    ]


async def delete_record(date: str) -> bool:
    """删除指定日期的记录。

    Args:
        date: 记录日期, 格式 yyyy-mm-dd。

    Returns:
        是否确有记录被删除。
    """
    async with get_connection() as conn:
        cursor = await conn.execute(
            "DELETE FROM weight_records WHERE date = ?", (date,)
        )
        await conn.commit()
        return cursor.rowcount > 0
