"""移动平均计算模块。

对体重记录序列计算指定窗口的移动平均值。

说明:
    此处的 "N 日移动平均" 采用 "最近 N 条记录" 的口径(即 N 个数据点),
    对每条记录取其自身及之前共 N 条记录求均值。当记录不足 N 条时,
    使用当前已有的全部记录求均值。该口径对存在缺录的日期更稳健。
"""


def attach_moving_averages(
    records: list[dict],
    windows: list[int],
) -> list[dict]:
    """为按日期升序排列的记录附加移动平均值。

    Args:
        records: 记录列表, 每项至少包含 "weight" 字段, 需按日期升序排列。
        windows: 移动平均窗口列表, 例如 [3, 7]。

    Returns:
        增强后的记录列表, 每项新增 "ma_{window}" 字段(保留两位小数);
        当窗口内尚无足够数据时该值为对应已有数据的均值。
    """
    enhanced: list[dict] = []
    weights: list[float] = []

    for record in records:
        weights.append(record["weight"])
        item = dict(record)
        for window in windows:
            recent = weights[-window:]
            item[f"ma_{window}"] = round(sum(recent) / len(recent), 2)
        enhanced.append(item)

    return enhanced
