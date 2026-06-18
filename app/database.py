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

# 放纵记录建表语句。一次喝酒/吃好吃的即一条记录, 与每日体重解耦:
# 同一天可能有多条(既喝酒又吃), 故用自增 id 作主键而非以日期约束唯一。
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
        await conn.commit()
