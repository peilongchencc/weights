"""放纵记录接口的集成测试。"""


def test_indulgence_default_empty(client):
    """初始无数据时, 查询返回空列表。"""
    resp = client.get("/api/indulgences")
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["request_id"]
    assert body["data"]["records"] == []


def test_indulgence_create_and_list(client):
    """新增后可查询到, 响应头携带一致的 request_id。"""
    resp = client.post(
        "/api/indulgences",
        json={
            "date": "2026-06-18",
            "kinds": ["alcohol"],
            "trigger": "stress",
            "note": "加班压力大",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert resp.headers["X-Request-ID"] == body["request_id"]
    assert body["data"]["id"] >= 1
    assert body["data"]["kinds"] == ["alcohol"]

    records = client.get("/api/indulgences").json()["data"]["records"]
    assert len(records) == 1
    assert records[0]["trigger"] == "stress"
    assert records[0]["note"] == "加班压力大"


def test_indulgence_multiple_kinds(client):
    """单条记录可同时选择喝酒与吃好吃的, 读取时还原为列表。"""
    resp = client.post(
        "/api/indulgences",
        json={
            "date": "2026-06-18",
            "kinds": ["alcohol", "food"],
            "trigger": "reward",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["kinds"] == ["alcohol", "food"]

    records = client.get("/api/indulgences").json()["data"]["records"]
    assert records[0]["kinds"] == ["alcohol", "food"]


def test_indulgence_kinds_deduped(client):
    """重复的类型会被去重存储。"""
    resp = client.post(
        "/api/indulgences",
        json={
            "date": "2026-06-18",
            "kinds": ["food", "food"],
            "trigger": "reward",
        },
    )
    assert resp.json()["data"]["kinds"] == ["food"]


def test_indulgence_same_day_multiple(client):
    """同一天可记录多条, 不会互相覆盖。"""
    client.post(
        "/api/indulgences",
        json={"date": "2026-06-18", "kinds": ["alcohol"], "trigger": "stress"},
    )
    client.post(
        "/api/indulgences",
        json={"date": "2026-06-18", "kinds": ["food"], "trigger": "reward"},
    )
    records = client.get("/api/indulgences").json()["data"]["records"]
    assert len(records) == 2


def test_indulgence_list_ordered_desc(client):
    """列表按日期倒序返回, 最新在前。"""
    client.post(
        "/api/indulgences",
        json={"date": "2026-06-10", "kinds": ["food"], "trigger": "reward"},
    )
    client.post(
        "/api/indulgences",
        json={"date": "2026-06-18", "kinds": ["alcohol"], "trigger": "stress"},
    )
    records = client.get("/api/indulgences").json()["data"]["records"]
    assert [r["date"] for r in records] == ["2026-06-18", "2026-06-10"]


def test_indulgence_delete(client):
    """删除指定 id 的记录, 重复删除返回 404。"""
    created = client.post(
        "/api/indulgences",
        json={"date": "2026-06-18", "kinds": ["alcohol"], "trigger": "stress"},
    ).json()["data"]
    indulgence_id = created["id"]

    resp = client.delete(f"/api/indulgences/{indulgence_id}")
    assert resp.status_code == 200
    assert resp.json()["data"]["deleted"] is True

    assert client.get("/api/indulgences").json()["data"]["records"] == []

    resp_again = client.delete(f"/api/indulgences/{indulgence_id}")
    assert resp_again.json()["code"] == 404
    assert resp_again.json()["data"]["deleted"] is False


def test_indulgence_empty_kinds_rejected(client):
    """kinds 为空数组时被校验拦截。"""
    resp = client.post(
        "/api/indulgences",
        json={"date": "2026-06-18", "kinds": [], "trigger": "stress"},
    )
    assert resp.status_code == 422


def test_indulgence_invalid_enum_rejected(client):
    """kinds / trigger 取值不在枚举内时被校验拦截。"""
    assert (
        client.post(
            "/api/indulgences",
            json={"date": "2026-06-18", "kinds": ["smoke"], "trigger": "stress"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/indulgences",
            json={"date": "2026-06-18", "kinds": ["alcohol"], "trigger": "boredom"},
        ).status_code
        == 422
    )


def test_indulgence_invalid_date_rejected(client):
    """非法日期格式被校验拦截。"""
    resp = client.post(
        "/api/indulgences",
        json={"date": "2026/06/18", "kinds": ["alcohol"], "trigger": "stress"},
    )
    assert resp.status_code == 422
