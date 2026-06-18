"""数据库模块。

封装 SQLite(aiosqlite) 的连接获取与初始化逻辑。
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import aiosqlite

from app.config import DB_PATH

# 体重记录建表语句。date 作为唯一主键, 保证一天仅一条记录。
_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS weight_records (
    date    TEXT PRIMARY KEY,
    weight  REAL NOT NULL,
    note    TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

# 个人档案建表语句。身高等不随日期变化的全局信息, 用单行表存储:
# 通过 CHECK(id = 1) 约束确保整表至多一行。
_CREATE_PROFILE_SQL = """
CREATE TABLE IF NOT EXISTS profile (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    height_cm  REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

# 放纵记录建表语句。类型(喝酒/吃好吃的)已支持单条多选, 故约定"一天一条":
# 仍保留自增 id 作主键(供编辑/删除按 id 定位), 再以 date 唯一约束保证一天一条,
# 同一天再次提交时按 date 冲突执行更新(upsert)。
_CREATE_INDULGENCE_SQL = """
CREATE TABLE IF NOT EXISTS indulgences (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    trigger    TEXT NOT NULL,
    note       TEXT,
    created_at TEXT NOT NULL
);
"""

# 放纵记录"一天一条"的唯一约束。历史库可能未带此约束, 启动时补建唯一索引;
# 若历史数据存在同日多条会建索引失败, 此处用 IF NOT EXISTS 保证幂等创建。
_CREATE_INDULGENCE_DATE_INDEX_SQL = """
CREATE UNIQUE INDEX IF NOT EXISTS idx_indulgences_date ON indulgences (date);
"""


@asynccontextmanager
async def get_connection() -> AsyncIterator[aiosqlite.Connection]:
    """提供一个数据库连接的异步上下文管理器。

    连接在退出时自动关闭, 调用方无需手动 try/finally。

    Yields:
        已开启行工厂(Row)的 aiosqlite 连接对象。
    """
    conn = await aiosqlite.connect(DB_PATH)
    conn.row_factory = aiosqlite.Row
    try:
        yield conn
    finally:
        await conn.close()


async def init_db() -> None:
    """初始化数据库, 确保数据表存在。"""
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(_CREATE_TABLE_SQL)
        await conn.execute(_CREATE_PROFILE_SQL)
        await conn.execute(_CREATE_INDULGENCE_SQL)
        await conn.execute(_CREATE_INDULGENCE_DATE_INDEX_SQL)
        await conn.commit()
