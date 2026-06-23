"""应用配置模块。

负责从 .env 文件加载环境变量, 并对外提供统一的配置访问入口。
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# 项目根目录(本文件位于 app/ 下, 上一级即为根目录)
BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def _parse_windows(raw: str) -> list[int]:
    """解析移动平均窗口配置字符串。

    Args:
        raw: 形如 "3,7" 的逗号分隔字符串。

    Returns:
        升序排列且去重后的窗口天数列表, 解析失败时回退为 [3, 7]。
    """
    try:
        windows = sorted({int(item.strip()) for item in raw.split(",") if item.strip()})
        return windows or [3, 7]
    except ValueError:
        return [3, 7]


HOST: str = os.getenv("HOST", "127.0.0.1")
PORT: int = int(os.getenv("PORT", "8421"))
DB_PATH: Path = BASE_DIR / os.getenv("DB_PATH", "weights.db")
LOG_PATH: Path = BASE_DIR / os.getenv("LOG_PATH", "logs/app.log")
MA_WINDOWS: list[int] = _parse_windows(os.getenv("MA_WINDOWS", "3,7"))
# 达标/维持判定的区间半宽(kg): 最大窗口均值进入 [目标-band, 目标+band] 即视为达标。
TARGET_BAND: float = float(os.getenv("TARGET_BAND", "1.0"))
# 是否开启热重载。开发可设为 true; 后台运行建议保持 false 以确保单进程, 便于 kill。
RELOAD: bool = os.getenv("RELOAD", "false").lower() in ("1", "true", "yes")
