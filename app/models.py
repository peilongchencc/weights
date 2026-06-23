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


class IndulgenceUpdate(BaseModel):
    """编辑放纵记录的请求体(不含日期)。

    放纵记录约定"一天一条", 日期作为记录的归属标识不在编辑范围内;
    编辑仅允许修改类型 / 触发原因 / 备注。

    Attributes:
        kinds: 放纵类型(可多选), 取值为 alcohol(喝酒) / food(吃好吃的), 至少一项。
        trigger: 触发原因, stress(压力) 或 reward(奖励)。
        note: 备注, 可选。
    """

    kinds: list[Literal["alcohol", "food"]] = Field(
        ..., min_length=1, description="类型(可多选): alcohol / food"
    )
    trigger: Literal["stress", "reward"] = Field(
        ..., description="触发原因: stress / reward"
    )
    note: str | None = Field(default=None, max_length=500, description="备注, 可选")

    @field_validator("kinds")
    @classmethod
    def dedupe_kinds(cls, value: list[str]) -> list[str]:
        """去重并保持稳定顺序, 避免同一类型重复存储。"""
        seen: list[str] = []
        for item in value:
            if item not in seen:
                seen.append(item)
        return seen

    @field_validator("note")
    @classmethod
    def strip_note(cls, value: str | None) -> str | None:
        """去除备注首尾空白, 空字符串归一化为 None。"""
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class IndulgenceCreate(IndulgenceUpdate):
    """创建/更新放纵记录的请求体。

    放纵记录用于追踪"压力大喝啤酒"或"奖励自己吃好吃的"等行为,
    与每日体重解耦; 约定一天一条, 同一天再次提交按日期覆盖(upsert)。

    Attributes:
        date: 发生日期, 格式 yyyy-mm-dd; 其余字段继承自 IndulgenceUpdate。
    """

    date: str = Field(..., description="日期, 格式 yyyy-mm-dd")

    @field_validator("date")
    @classmethod
    def validate_date(cls, value: str) -> str:
        """校验日期格式是否为 yyyy-mm-dd。"""
        return _validate_iso_date(value)


class ProfileUpdate(BaseModel):
    """更新个人档案的请求体。

    身高是不随日期变化的全局信息, 单独存储, 不放进每日记录。

    Attributes:
        height_cm: 身高, 单位 cm, 取值范围 50-300。
    """

    height_cm: float = Field(..., ge=50, le=300, description="身高(cm), 范围 50-300")


class TargetUpdate(BaseModel):
    """更新目标体重的请求体。

    目标体重与起点日期都是全局档案信息, 与每日记录解耦。起点日期用于在前端
    定位"起点的移动平均", 据此计算已减重量与减重进度。

    Attributes:
        target_weight: 目标体重(kg), 必填且需大于 0。
        target_start_date: 起点日期, 格式 yyyy-mm-dd, 默认为设定目标当天。
    """

    target_weight: float = Field(
        ..., gt=0, le=1000, description="目标体重(kg), 必填"
    )
    target_start_date: str = Field(..., description="起点日期, 格式 yyyy-mm-dd")

    @field_validator("target_start_date")
    @classmethod
    def validate_start_date(cls, value: str) -> str:
        """校验起点日期格式为 yyyy-mm-dd, 且不晚于今天。

        起点日期用于回溯"起点的均值", 落在未来没有实际意义(也无对应记录),
        故在格式校验之外再拒绝未来日期, 与前端日历"禁止选择未来日期"保持一致。

        Raises:
            ValueError: 格式非法或日期晚于今天时抛出。
        """
        normalized = _validate_iso_date(value)
        if date_type.fromisoformat(normalized) > date_type.today():
            raise ValueError("起点日期不能晚于今天")
        return normalized
