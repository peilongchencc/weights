"""个人档案(身高)接口的集成测试。"""


def test_profile_default_empty(client):
    """未设置身高时, 查询返回 height_cm 为 None。"""
    resp = client.get("/api/profile")
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["request_id"]
    assert body["data"]["height_cm"] is None


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
