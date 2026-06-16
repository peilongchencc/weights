# 每日体重记录

- [每日体重记录](#每日体重记录)
  - [功能特性](#功能特性)
  - [目录结构](#目录结构)
  - [快速开始](#快速开始)
  - [后台运行](#后台运行)
  - [接口说明](#接口说明)
  - [测试](#测试)
  - [配置项 (.env)](#配置项-env)

一个用于记录每日体重并自动计算 **3 日 / 7 日移动平均** 的小工具。后端基于 FastAPI + SQLite, 前端为原生 HTML/CSS/JS, 包含录入表单、统计卡片、趋势图与历史记录表。

## 功能特性

- 录入每日体重(必填, 单位 kg)与备注(可选)。
- 日期在页面打开时自动取本地当天日期(`yyyy-mm-dd`), 也可手动修改。
- 同一天重复提交会覆盖更新(一天一条)。
- 自动计算移动平均: 默认 3 日与 7 日, 可在 `.env` 中通过 `MA_WINDOWS` 调整。前端会按接口返回的窗口**动态渲染**统计卡片、表格列与趋势曲线, 修改 `MA_WINDOWS` 无需改前端代码。
- 趋势图同时展示体重曲线与各窗口的移动平均曲线。
- 支持删除任意一天的记录。

> 移动平均口径: 采用"最近 N 条记录"(即 N 个数据点)的均值。对每条记录取其自身及之前共 N 条记录求平均; 不足 N 条时用已有记录求平均。该口径对存在缺录的日期更稳健。

## 目录结构

```
weights/
├── app/
│   ├── config.py            # 环境配置加载
│   ├── database.py          # SQLite 连接(上下文管理器)与初始化
│   ├── models.py            # 请求体校验模型
│   ├── moving_average.py    # 移动平均计算
│   ├── crud.py              # 数据库增删改查
│   ├── request_context.py   # request_id 中间件/依赖项/全局异常处理
│   ├── routers/
│   │   └── records.py       # 体重记录接口
│   └── main.py              # FastAPI 应用入口
├── static/                  # 前端页面 (index.html / style.css / app.js)
├── tests/                   # pytest 单元/集成测试
├── requirements.txt         # 运行依赖
├── requirements-dev.txt     # 测试依赖
└── .env
```

## 快速开始

```bash
# 1. 创建并激活 conda 环境
conda create -n weights python=3.12 -y
conda activate weights

# 2. 安装依赖
pip install -r requirements.txt

# 3. 启动服务
python -m app.main
```

启动后访问 <http://127.0.0.1:8000> 即可使用。

## 后台运行

后台模式默认关闭热重载(`.env` 中 `RELOAD=false`), 保证单进程, 停止时不会残留孤儿进程。

```bash
# 启动: 输出重定向到日志文件
conda activate weights
nohup python -m app.main > logs/server.log 2>&1 &

# 查看实时日志
tail -f logs/server.log
```

查看服务是否在运行(端口取自 `.env` 的 `PORT`, 默认 8000):

```bash
lsof -i:8000          # 查看占用 8000 端口的进程
```

停止服务(按端口号, 精确结束监听该端口的进程):

```bash
lsof -ti:8000 | xargs kill
```

## 接口说明

所有响应均为统一结构, 并包含用于日志追踪的 `request_id`。`request_id` 由中间件统一生成, 同时回填到响应头 `X-Request-ID`, 便于客户端与服务端日志对齐。即使发生未捕获异常, 也会返回统一结构(`code=500`)并携带同一 `request_id`。

| 方法   | 路径                  | 说明                       |
| ------ | --------------------- | -------------------------- |
| POST   | `/api/records`        | 新增/更新一天的体重记录    |
| GET    | `/api/records`        | 查询全部记录(含移动平均)   |
| DELETE | `/api/records/{date}` | 删除指定日期的记录         |

请求示例(POST `/api/records`):

```json
{ "date": "2026-06-16", "weight": 91.1, "note": "晨起空腹" }
```

响应示例:

```json
{
  "code": 200,
  "message": "记录保存成功",
  "request_id": "b1e7...",
  "data": { "date": "2026-06-16", "weight": 91.1, "note": "晨起空腹" }
}
```

## 测试

```bash
conda activate weights
pip install -r requirements-dev.txt
python -m pytest -q
```

测试覆盖移动平均计算(纯函数)与三个接口的增删改查、覆盖更新、参数校验及 `request_id` 一致性。

## 配置项 (.env)

| 变量         | 说明                         | 默认值          |
| ------------ | ---------------------------- | --------------- |
| `HOST`       | 监听地址                     | `127.0.0.1`     |
| `PORT`       | 监听端口                     | `8000`          |
| `DB_PATH`    | SQLite 文件路径              | `weights.db`    |
| `LOG_PATH`   | 日志文件路径                 | `logs/app.log`  |
| `MA_WINDOWS` | 移动平均窗口(逗号分隔, 天)   | `3,7`           |
```
