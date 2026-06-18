"""数据模型模块。

定义请求体校验所需的 Pydantic 模型。
"""

from datetime import date as date_type
from typing import Literal

from pydantic import BaseModel, Field, field_validator


def _validate_iso_date(value: str) -> str:
    """校验日期字符串是否为 yyyy-mm-dd 格式。

    Args:
        value: 待校验的日期字符串。

    Returns:
        原样返回校验通过的日期字符串。

    Raises:
        ValueError: 格式不为 yyyy-mm-dd 时抛出。
    """
    try:
        date_type.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("日期格式必须为 yyyy-mm-dd") from exc
    return value


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
        return _validate_iso_date(value)

    @field_validator("note")
    @classmethod
    def strip_note(cls, value: str | None) -> str | None:
        """去除备注首尾空白, 空字符串归一化为 None。"""
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class IndulgenceCreate(BaseModel):
    """创建放纵记录的请求体。

    放纵记录用于追踪"压力大喝啤酒"或"奖励自己吃好吃的"等行为,
    与每日体重解耦; 同一天可记录多条。

    Attributes:
        kinds: 放纵类型(可多选), 取值为 alcohol(喝酒) / food(吃好吃的), 至少一项。
        trigger: 触发原因, stress(压力) 或 reward(奖励)。
        note: 备注, 可选。
        date: 发生日期, 格式 yyyy-mm-dd。
    """

    kinds: list[Literal["alcohol", "food"]] = Field(
        ..., min_length=1, description="类型(可多选): alcohol / food"
    )
    trigger: Literal["stress", "reward"] = Field(
        ..., description="触发原因: stress / reward"
    )
    note: str | None = Field(default=None, max_length=500, description="备注, 可选")
    date: str = Field(..., description="日期, 格式 yyyy-mm-dd")

    @field_validator("kinds")
    @classmethod
    def dedupe_kinds(cls, value: list[str]) -> list[str]:
        """去重并保持稳定顺序, 避免同一类型重复存储。"""
        seen: list[str] = []
        for item in value:
            if item not in seen:
                seen.append(item)
        return seen

    @field_validator("date")
    @classmethod
    def validate_date(cls, value: str) -> str:
        """校验日期格式是否为 yyyy-mm-dd。"""
        return _validate_iso_date(value)

    @field_validator("note")
    @classmethod
    def strip_note(cls, value: str | None) -> str | None:
        """去除备注首尾空白, 空字符串归一化为 None。"""
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class ProfileUpdate(BaseModel):
    """更新个人档案的请求体。

    身高是不随日期变化的全局信息, 单独存储, 不放进每日记录。

    Attributes:
        height_cm: 身高, 单位 cm, 取值范围 50-300。
    """

    height_cm: float = Field(..., ge=50, le=300, description="身高(cm), 范围 50-300")
