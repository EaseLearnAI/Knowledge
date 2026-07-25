# Memo 后端交互 API 文档

## 1. 基本约定

| 项目 | 值 |
|---|---|
| 本地 Base URL | `http://127.0.0.1:3100` |
| API 前缀 | `/api/v1` |
| 数据库 | `mongodb://localhost:27017/memo_knowledge` |
| JSON 请求头 | `Content-Type: application/json` |
| 鉴权 | `Authorization: Bearer <accessToken>` |
| 幂等写入 | `Idempotency-Key: <客户端生成的 UUID>` |

成功响应：

```json
{
  "success": true,
  "data": {}
}
```

失败响应：

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数不符合要求",
    "details": [],
    "requestId": "8ba907f0-..."
  }
}
```

## 2. 账号接口

### 2.1 注册

`POST /api/v1/auth/register`

请求：

```json
{
  "identifier": "user@example.com",
  "password": "Password123",
  "nickname": "沐阳"
}
```

`identifier` 同时支持：

- 邮箱，例如 `user@example.com`；
- 中国大陆手机号，例如 `13800138000`，服务端会规范化为 `+8613800138000`；
- 国际 E.164 手机号，例如 `+14155552671`。

成功 `201`：

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "687...",
      "email": "user@example.com",
      "phone": null,
      "nickname": "沐阳",
      "createdAt": "2026-07-19T09:00:00.000Z"
    },
    "accessToken": "eyJ...",
    "refreshToken": "opaque-refresh-token",
    "tokenType": "Bearer"
  }
}
```

失败：

| HTTP | code | 场景 |
|---:|---|---|
| 409 | `ACCOUNT_EXISTS` | 手机号或邮箱已注册 |
| 422 | `VALIDATION_ERROR` | 手机号/邮箱错误、密码少于 8 位或不含字母/数字 |

### 2.2 登录

`POST /api/v1/auth/login`

请求：

```json
{
  "identifier": "13800138000",
  "password": "Password123"
}
```

成功 `200`：与注册成功响应的 `data` 相同。

失败：

| HTTP | code | 场景 |
|---:|---|---|
| 401 | `INVALID_CREDENTIALS` | 手机号、邮箱或密码错误 |
| 422 | `VALIDATION_ERROR` | 参数格式错误 |

### 2.3 刷新登录态

`POST /api/v1/auth/refresh`

```json
{ "refreshToken": "opaque-refresh-token" }
```

成功 `200`：返回一套新令牌，旧刷新令牌立刻失效，客户端必须原子替换。

失败 `401`：

```json
{
  "success": false,
  "error": {
    "code": "REFRESH_TOKEN_INVALID",
    "message": "刷新令牌无效或已过期",
    "requestId": "..."
  }
}
```

### 2.4 退出

`POST /api/v1/auth/logout`

请求同刷新接口。成功 `204`，无响应体。

### 2.5 当前用户

`GET /api/v1/auth/me`

需要 Bearer Token。成功 `200` 返回用户，不返回密码哈希。

## 3. 视频解析接口

### 3.1 提交视频链接

`POST /api/v1/captures`

请求头：

```text
Authorization: Bearer <accessToken>
Idempotency-Key: 由客户端生成的 UUID
Content-Type: application/json
```

请求：

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "quality": "balanced",
  "language": "zh"
}
```

`quality`：

- `fast`：Whisper base；
- `balanced`：Whisper small，默认；
- `accurate`：Whisper large-v3。

成功 `202`：

```json
{
  "success": true,
  "data": {
    "_id": "task_id",
    "sourceItemId": "source_id",
    "status": "queued",
    "stage": "queued",
    "progress": 0
  }
}
```

同一用户使用同一个 `Idempotency-Key` 重试时，返回同一任务，不重复解析。

失败：

| HTTP | code | 场景 |
|---:|---|---|
| 401 | `AUTH_REQUIRED` / `TOKEN_INVALID` | 未登录或令牌过期 |
| 422 | `VALIDATION_ERROR` | URL 无效或平台暂不支持 |
| 502 | `VIDEO_PROCESSING_FAILED` | 下载、FFmpeg 或 Whisper 失败，异步记录在任务中 |

### 3.2 上传音视频

`POST /api/v1/captures/upload`

`multipart/form-data`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `file` | 文件 | 是 | MP4、MOV、WebM、MP3、M4A、WAV，最大 512 MB |
| `quality` | 文本 | 否 | `fast` / `balanced` / `accurate` |
| `language` | 文本 | 否 | `zh` / `en` / `ja` / `auto` |

成功 `202` 与链接提交相同。

### 3.3 查询任务

`GET /api/v1/tasks/{taskId}`

成功 `200`：

```json
{
  "success": true,
  "data": {
    "_id": "task_id",
    "sourceItemId": "source_id",
    "status": "completed",
    "stage": "completed",
    "progress": 100,
    "logs": [
      {
        "timestamp": "2026-07-19T09:00:00.000Z",
        "level": "info",
        "event": "video.transcribe.completed",
        "message": "转录完成"
      }
    ]
  }
}
```

状态：`queued`、`processing`、`completed`、`failed`。

失败任务包含：

```json
{
  "status": "failed",
  "error": {
    "code": "VIDEO_PROCESSING_FAILED",
    "message": "具体可诊断错误"
  }
}
```

### 3.4 实时任务日志

`GET /api/v1/tasks/{taskId}/events`

需要 Bearer Token，返回 `text/event-stream`。每条事件：

```text
id: 12
data: {"event":"video.cli.stdout","message":"transcribe: model=small",...}
```

前端断线后仍可回退为轮询 `GET /tasks/{id}`。

## 4. 内容接口

### 4.1 收藏列表

`GET /api/v1/items?status=completed&q=AI&page=1&pageSize=20`

成功 `200`：

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0
  }
}
```

列表不返回完整转录正文，避免响应过大。

### 4.2 内容详情

`GET /api/v1/items/{sourceId}`

完成后的核心字段：

```json
{
  "title": "视频标题",
  "status": "completed",
  "transcript": {
    "text": "完整转录",
    "segments": [
      { "startMs": 0, "endMs": 12000, "text": "带时间戳证据" }
    ],
    "provider": "videosummarize-local-whisper"
  },
  "copywriting": {
    "oneSentenceSummary": "一句话总结",
    "whyWorthWatching": "为什么值得看",
    "keyPoints": ["关键观点"],
    "chapters": [
      { "title": "章节", "startMs": 0, "endMs": 12000, "summary": "章节摘要" }
    ],
    "actionItems": ["可执行动作"],
    "tags": ["AI", "产品"],
    "markdown": "# 可直接承接的完整文案",
    "provider": "local-deterministic"
  }
}
```

### 4.3 删除内容

`DELETE /api/v1/items/{sourceId}`

成功 `204`。服务端采用软删除，避免同步时内容“复活”。

## 5. 健康、文档和 Web 终端

| 方法 | URL | 说明 |
|---|---|---|
| GET | `/health` | 进程存活 |
| GET | `/ready` | MongoDB 已连接，可接流量 |
| GET | `/docs/openapi.yaml` | OpenAPI 3.1 契约 |
| GET | `/terminal` | Web 实时终端 |
| GET | `/api/v1/logs/stream?token=...` | 本地调试日志 SSE |

生产环境必须设置 `ENABLE_WEB_TERMINAL=false`，或替换强随机终端令牌。

## 6. 前端错误处理建议

| code | 前端行为 |
|---|---|
| `TOKEN_INVALID` | 用 refreshToken 刷新一次；仍失败则回登录 |
| `REFRESH_TOKEN_INVALID` | 清空本地登录态 |
| `VALIDATION_ERROR` | 展示字段错误 |
| `VIDEO_PROCESSING_FAILED` | 保留收藏，展示失败原因和重试入口 |
| `TASK_NOT_FOUND` / `ITEM_NOT_FOUND` | 返回列表并刷新 |
| `MINIMAX_API_KEY_MISSING` | 提示服务端模型配置缺失，不丢转录 |
