"""移动平均计算的单元测试。"""

from app.moving_average import attach_moving_averages


def test_single_record_uses_available_data():
    """记录不足窗口长度时, 用已有数据求均值。"""
    records = [{"date": "2026-06-01", "weight": 90.0}]
    result = attach_moving_averages(records, [3, 7])
    assert result[0]["ma_3"] == 90.0
    assert result[0]["ma_7"] == 90.0


def test_window_uses_recent_n_points():
    """窗口取最近 N 条记录的均值。"""
    records = [
        {"weight": 90.0},
        {"weight": 92.0},
        {"weight": 94.0},
        {"weight": 96.0},
    ]
    result = attach_moving_averages(records, [3])
    assert result[2]["ma_3"] == 92.0  # (90+92+94)/3
    assert result[3]["ma_3"] == 94.0  # (92+94+96)/3


def test_rounds_to_two_decimals():
    """均值保留两位小数。"""
    records = [{"weight": 90.0}, {"weight": 91.0}, {"weight": 91.0}]
    result = attach_moving_averages(records, [3])
    assert result[2]["ma_3"] == 90.67  # (90+91+91)/3 = 90.666...


def test_does_not_mutate_input():
    """计算不应修改入参中的原始记录。"""
    records = [{"weight": 90.0}]
    attach_moving_averages(records, [3])
    assert "ma_3" not in records[0]


def test_custom_windows():
    """支持任意自定义窗口。"""
    records = [{"weight": 90.0}, {"weight": 100.0}]
    result = attach_moving_averages(records, [2])
    assert result[1]["ma_2"] == 95.0


def test_empty_records():
    """空记录列表返回空结果。"""
    assert attach_moving_averages([], [3, 7]) == []
