"""数据模型模块。

定义请求体校验所需的 Pydantic 模型。
"""

from datetime import date as date_type

from pydantic import BaseModel, Field, field_validator


class WeightCreate(BaseModel):
    """创建/更新体重记录的请求体。

    Attributes:
        weight: 体重, 单位 kg, 必填且需大于 0。
        note: 备注, 可选。
        date: 记录日期, 格式 yyyy-mm-dd, 默认由前端传入当天日期。
    """

    weight: float = Field(..., gt=0, le=1000, description="体重(kg), 必填")
    note: str | None = Field(default=None, max_length=500, description="备注, 可选")
    date: str = Field(..., description="日期, 格式 yyyy-mm-dd")

    @field_validator("date")
    @classmethod
    def validate_date(cls, value: str) -> str:
        """校验日期格式是否为 yyyy-mm-dd。"""
        try:
            date_type.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("日期格式必须为 yyyy-mm-dd") from exc
        return value

    @field_validator("note")
    @classmethod
    def strip_note(cls, value: str | None) -> str | None:
        """去除备注首尾空白, 空字符串归一化为 None。"""
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None
