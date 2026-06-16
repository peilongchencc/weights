"""测试公共夹具。

在导入应用前指定独立的临时数据库与移动平均窗口, 避免污染真实数据。
"""

import os
import tempfile
from pathlib import Path

import pytest

# 必须在导入应用模块前设置, 因为 config 在导入时即读取这些环境变量
_TMP_DB = Path(tempfile.gettempdir()) / "weights_test.db"
os.environ["DB_PATH"] = str(_TMP_DB)
os.environ["MA_WINDOWS"] = "3,7"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    """提供一个使用全新临时数据库的测试客户端。

    进入 TestClient 上下文会触发 lifespan, 自动建表; 每个测试前后清理数据库文件。
    """
    if _TMP_DB.exists():
        _TMP_DB.unlink()
    with TestClient(app) as test_client:
        yield test_client
    if _TMP_DB.exists():
        _TMP_DB.unlink()
