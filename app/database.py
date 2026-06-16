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
        await conn.commit()
