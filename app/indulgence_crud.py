"""放纵记录数据访问模块。

封装对 indulgences 表的增/改、查、删操作。放纵记录(喝酒/吃好吃的)与每日
体重解耦, 约定"一天一条"(类型已支持单条多选), 故按日期 upsert: 同一天
再次提交即更新覆盖。仍保留自增 id, 供编辑/删除按 id 精确定位。
"""

from datetime import datetime, timezone

from app.database import get_connection


def _now_iso() -> str:
    """返回当前 UTC 时间的 ISO8601 字符串。"""
    return datetime.now(timezone.utc).isoformat()


async def upsert_indulgence(
    date: str, kinds: list[str], trigger: str, note: str | None
) -> dict:
    """新增或更新某一天的放纵记录(一天一条)。

    多个类型(如同时喝酒又吃)以逗号拼接存入单列, 读取时再拆回列表。
    同一天再次提交时, 按 date 冲突更新 kind / trigger / note, 并复用原 id。

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
        await conn.execute(
            """
            INSERT INTO indulgences (date, kind, trigger, note, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                kind = excluded.kind,
                trigger = excluded.trigger,
                note = excluded.note
            """,
            (date, kind_str, trigger, note, now),
        )
        await conn.commit()
        cursor = await conn.execute(
            "SELECT id FROM indulgences WHERE date = ?", (date,)
        )
        row = await cursor.fetchone()

    return {
        "id": row["id"],
        "date": date,
        "kinds": kinds,
        "trigger": trigger,
        "note": note,
    }


async def update_indulgence(
    indulgence_id: int, kinds: list[str], trigger: str, note: str | None
) -> dict | None:
    """编辑指定 id 的放纵记录(可改类型 / 触发原因 / 备注, 日期不变)。

    Args:
        indulgence_id: 记录的自增主键。
        kinds: 类型列表, 元素为 alcohol(喝酒) / food(吃好吃的), 至少一项。
        trigger: 触发原因, stress(压力) 或 reward(奖励)。
        note: 备注, 可为 None。

    Returns:
        更新后的记录字典(含 date); 未找到对应 id 时返回 None。
    """
    kind_str = ",".join(kinds)
    async with get_connection() as conn:
        cursor = await conn.execute(
            """
            UPDATE indulgences
            SET kind = ?, trigger = ?, note = ?
            WHERE id = ?
            """,
            (kind_str, trigger, note, indulgence_id),
        )
        await conn.commit()
        if cursor.rowcount == 0:
            return None
        date_cursor = await conn.execute(
            "SELECT date FROM indulgences WHERE id = ?", (indulgence_id,)
        )
        row = await date_cursor.fetchone()

    return {
        "id": indulgence_id,
        "date": row["date"],
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
