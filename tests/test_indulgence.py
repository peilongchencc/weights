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


def test_indulgence_same_day_upsert(client):
    """约定一天一条: 同一天再次提交按日期覆盖, 且复用原 id。"""
    first = client.post(
        "/api/indulgences",
        json={"date": "2026-06-18", "kinds": ["alcohol"], "trigger": "stress"},
    ).json()["data"]
    second = client.post(
        "/api/indulgences",
        json={
            "date": "2026-06-18",
            "kinds": ["food"],
            "trigger": "reward",
            "note": "改主意了",
        },
    ).json()["data"]

    # id 不变(同日覆盖), 内容更新为后一次提交
    assert second["id"] == first["id"]

    records = client.get("/api/indulgences").json()["data"]["records"]
    assert len(records) == 1
    assert records[0]["kinds"] == ["food"]
    assert records[0]["trigger"] == "reward"
    assert records[0]["note"] == "改主意了"


def test_indulgence_update(client):
    """编辑接口可修改类型 / 触发原因 / 备注, 日期保持不变。"""
    created = client.post(
        "/api/indulgences",
        json={"date": "2026-06-18", "kinds": ["alcohol"], "trigger": "stress"},
    ).json()["data"]
    indulgence_id = created["id"]

    resp = client.put(
        f"/api/indulgences/{indulgence_id}",
        json={"kinds": ["alcohol", "food"], "trigger": "reward", "note": "改下备注"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["data"]["date"] == "2026-06-18"
    assert body["data"]["kinds"] == ["alcohol", "food"]
    assert body["data"]["trigger"] == "reward"
    assert body["data"]["note"] == "改下备注"

    records = client.get("/api/indulgences").json()["data"]["records"]
    assert records[0]["kinds"] == ["alcohol", "food"]
    assert records[0]["note"] == "改下备注"


def test_indulgence_update_not_found(client):
    """编辑不存在的 id 返回 404。"""
    resp = client.put(
        "/api/indulgences/9999",
        json={"kinds": ["food"], "trigger": "reward"},
    )
    assert resp.json()["code"] == 404
    assert resp.json()["data"] is None


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
