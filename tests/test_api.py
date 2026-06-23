"""体重记录接口的集成测试。"""


def test_create_and_get(client):
    """录入后可查询到记录, 且响应包含动态窗口与 request_id。"""
    resp = client.post(
        "/api/records",
        json={"date": "2026-06-01", "weight": 90.5, "note": "晨起"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["request_id"]
    # 响应头携带与响应体一致的 request_id
    assert resp.headers["X-Request-ID"] == body["request_id"]

    resp = client.get("/api/records")
    data = resp.json()["data"]
    assert data["windows"] == [3, 7]
    assert data["target_band"] == 1.0
    assert len(data["records"]) == 1
    record = data["records"][0]
    assert record["ma_3"] == 90.5
    assert record["ma_7"] == 90.5


def test_upsert_same_date(client):
    """同一天重复提交执行覆盖更新。"""
    client.post("/api/records", json={"date": "2026-06-01", "weight": 90.0})
    client.post("/api/records", json={"date": "2026-06-01", "weight": 88.0})
    records = client.get("/api/records").json()["data"]["records"]
    assert len(records) == 1
    assert records[0]["weight"] == 88.0


def test_delete_existing(client):
    """删除存在的记录返回成功。"""
    client.post("/api/records", json={"date": "2026-06-01", "weight": 90.0})
    body = client.delete("/api/records/2026-06-01").json()
    assert body["code"] == 200
    assert body["data"]["deleted"] is True


def test_delete_missing(client):
    """删除不存在的记录返回 404 业务码。"""
    body = client.delete("/api/records/2099-01-01").json()
    assert body["code"] == 404
    assert body["data"]["deleted"] is False


def test_invalid_weight_rejected(client):
    """非法体重(<=0)被校验拦截。"""
    resp = client.post("/api/records", json={"date": "2026-06-01", "weight": -1})
    assert resp.status_code == 422


def test_invalid_date_rejected(client):
    """非法日期格式被校验拦截。"""
    resp = client.post(
        "/api/records", json={"date": "06-01-2026", "weight": 90.0}
    )
    assert resp.status_code == 422
