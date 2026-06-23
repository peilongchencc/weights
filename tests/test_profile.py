"""个人档案(身高)接口的集成测试。"""


def test_profile_default_empty(client):
    """未设置档案时, 查询返回身高与目标相关字段均为 None。"""
    resp = client.get("/api/profile")
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["request_id"]
    assert body["data"]["height_cm"] is None
    assert body["data"]["target_weight"] is None
    assert body["data"]["target_start_date"] is None


def test_profile_set_and_get(client):
    """设置身高后可查询到, 且响应头携带一致的 request_id。"""
    resp = client.put("/api/profile", json={"height_cm": 175.5})
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert resp.headers["X-Request-ID"] == body["request_id"]
    assert body["data"]["height_cm"] == 175.5

    data = client.get("/api/profile").json()["data"]
    assert data["height_cm"] == 175.5


def test_profile_update_overwrites(client):
    """再次设置身高执行覆盖更新, 且整表始终至多一行。"""
    client.put("/api/profile", json={"height_cm": 170})
    client.put("/api/profile", json={"height_cm": 180})
    data = client.get("/api/profile").json()["data"]
    assert data["height_cm"] == 180


def test_profile_invalid_height_rejected(client):
    """超出范围(50-300)的身高被校验拦截。"""
    assert client.put("/api/profile", json={"height_cm": 10}).status_code == 422
    assert client.put("/api/profile", json={"height_cm": 400}).status_code == 422


def test_target_set_and_get(client):
    """设置目标体重后可查询到, 且响应头携带一致的 request_id。"""
    resp = client.put(
        "/api/profile/target",
        json={"target_weight": 70, "target_start_date": "2026-06-01"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert resp.headers["X-Request-ID"] == body["request_id"]
    assert body["data"]["target_weight"] == 70
    assert body["data"]["target_start_date"] == "2026-06-01"

    data = client.get("/api/profile").json()["data"]
    assert data["target_weight"] == 70
    assert data["target_start_date"] == "2026-06-01"


def test_target_and_height_independent(client):
    """目标与身高共用单行表但各自独立写入, 互不覆盖。"""
    client.put("/api/profile", json={"height_cm": 175})
    client.put(
        "/api/profile/target",
        json={"target_weight": 68.5, "target_start_date": "2026-06-10"},
    )
    data = client.get("/api/profile").json()["data"]
    assert data["height_cm"] == 175
    assert data["target_weight"] == 68.5
    assert data["target_start_date"] == "2026-06-10"


def test_target_update_overwrites(client):
    """再次设置目标执行覆盖更新, 且整表始终至多一行。"""
    client.put(
        "/api/profile/target",
        json={"target_weight": 72, "target_start_date": "2026-05-01"},
    )
    client.put(
        "/api/profile/target",
        json={"target_weight": 70, "target_start_date": "2026-06-01"},
    )
    data = client.get("/api/profile").json()["data"]
    assert data["target_weight"] == 70
    assert data["target_start_date"] == "2026-06-01"


def test_target_invalid_rejected(client):
    """非法目标体重或日期格式被校验拦截。"""
    assert (
        client.put(
            "/api/profile/target",
            json={"target_weight": 0, "target_start_date": "2026-06-01"},
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/profile/target",
            json={"target_weight": 70, "target_start_date": "2026/06/01"},
        ).status_code
        == 422
    )


def test_target_future_start_date_rejected(client):
    """起点日期晚于今天被校验拦截(不能选未来日期)。"""
    from datetime import date, timedelta

    future = (date.today() + timedelta(days=1)).isoformat()
    assert (
        client.put(
            "/api/profile/target",
            json={"target_weight": 70, "target_start_date": future},
        ).status_code
        == 422
    )
