"""放纵记录数据访问模块。

封装对 indulgences 表的增、查、删操作。放纵记录(喝酒/吃好吃的)是与
每日体重解耦的独立事件, 同一天可有多条, 故以自增 id 标识每条记录。
"""

from datetime import datetime, timezone

from app.database import get_connection


def _now_iso() -> str:
    """返回当前 UTC 时间的 ISO8601 字符串。"""
    return datetime.now(timezone.utc).isoformat()


async def create_indulgence(
    date: str, kinds: list[str], trigger: str, note: str | None
) -> dict:
    """新增一条放纵记录。

    多个类型(如同时喝酒又吃)以逗号拼接存入单列, 读取时再拆回列表。

    Args:
        date: 发生日期, 格式 yyyy-mm-dd。
        kinds: 类型列表, 元素为 alcohol(喝酒) / food(吃好吃的), 至少一项。
        trigger: 触发原因, stress(压力) 或 reward(奖励)。
        note: 备注, 可为 None。

    Returns:
        写入后的记录字典, 含自增主键 id。
    """
    now = _now_iso()
    kind_str = ",".join(kinds)
    async with get_connection() as conn:
        cursor = await conn.execute(
            """
            INSERT INTO indulgences (date, kind, trigger, note, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (date, kind_str, trigger, note, now),
        )
        await conn.commit()
        new_id = cursor.lastrowid

    return {
        "id": new_id,
        "date": date,
        "kinds": kinds,
        "trigger": trigger,
        "note": note,
    }


async def list_indulgences() -> list[dict]:
    """查询全部放纵记录, 按日期与 id 倒序返回(最新在前)。

    Returns:
        记录字典列表, 字段含 id / date / kinds(列表) / trigger / note。
    """
    async with get_connection() as conn:
        cursor = await conn.execute(
            """
            SELECT id, date, kind, trigger, note
            FROM indulgences
            ORDER BY date DESC, id DESC
            """
        )
        rows = await cursor.fetchall()

    return [
        {
            "id": row["id"],
            "date": row["date"],
            "kinds": row["kind"].split(",") if row["kind"] else [],
            "trigger": row["trigger"],
            "note": row["note"],
        }
        for row in rows
    ]


async def delete_indulgence(indulgence_id: int) -> bool:
    """删除指定 id 的放纵记录。

    Args:
        indulgence_id: 记录的自增主键。

    Returns:
        是否确有记录被删除。
    """
    async with get_connection() as conn:
        cursor = await conn.execute(
            "DELETE FROM indulgences WHERE id = ?", (indulgence_id,)
        )
        await conn.commit()
        return cursor.rowcount > 0
