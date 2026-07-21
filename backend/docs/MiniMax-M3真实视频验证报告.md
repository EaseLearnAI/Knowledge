# MiniMax M3 真实视频验证报告

> 验证时间：2026-07-21<br>
> 服务地址：http://127.0.0.1:3110<br>
> 数据库：mongodb://localhost:27017/memo_knowledge

## 测试输入

- 视频：https://www.youtube.com/watch?v=EQfZCe3MkTU&t=874s
- 标题：I Can't Believe This App Makes $100K/Month
- 视频时长：17:35
- 转录质量：balanced，对应 Whisper small
- 语言：auto，实际识别为 English
- 文案 Provider：minimax-openai-compatible
- 文案模型：MiniMax-M3

## 最终结果

| 检查项 | 结果 |
|---|---|
| 健康检查 | HTTP 200 |
| 数据库就绪 | HTTP 200，connected |
| 注册 | HTTP 201 |
| 登录 | HTTP 200 |
| 视频任务创建 | HTTP 202 |
| 任务最终状态 | completed |
| 任务进度 | 100 |
| Task ID | 6a5f2eb69c6035f51385059c |
| Source Item ID | 6a5f2eb69c6035f51385059a |
| 转录字符数 | 19,672 |
| 时间戳片段 | 329 |
| 生成章节 | 11 |
| 承接文案 Markdown | 3,348 字符 |
| 最终模型字段 | MiniMax-M3 |

M3 返回的一句话总结：

> 20-year-old NYU student Michael built GoTall, a height prediction app making $100K/month, by validating demand in TikTok comments, mastering a single UGC content format, and ignoring the social pressure of pursuing a 'cringe' idea.

生成标签：mobile apps、indie hacking、startup ideas。

## 真实执行中发现并修复的问题

### 1. API 区域不匹配

国际域名 api.minimax.io 对当前密钥返回 401 invalid api key (2049)。切换到与密钥所属区域一致的国内官方域名 api.minimaxi.com 后，模型列表和聊天接口均返回 200，模型列表包含 MiniMax-M3。

### 2. 旧 Anthropic Provider 不支持当前 M3 接法

Provider 已切换为 OpenAI 兼容协议：POST /v1/chat/completions，使用 Bearer 鉴权。模型名和 API Base 均来自环境变量，后续换模不需要修改业务代码。

### 3. MLX Whisper 并行失败

初次处理成功完成下载和 FFmpeg 音频提取，但在可用内存约 4.8 GB 时启动 4 个 MLX 分块并行，进程异常退出。

修复后 URL Processor 显式传入 chunk-size 0，单个视频内部只运行一路 Whisper；多个视频任务仍由 Node.js 队列串行。本次测试复用已下载的 audio.wav 恢复，没有再次下载 91 MB 视频。

### 4. M3 章节时间缺少依据

旧 Prompt 只发送纯文本，却要求模型返回毫秒章节，第一次返回未通过 Schema。修复后每条转录都带 startMs-endMs 区间，模型从真实时间区间中选择章节，最终结果通过 Zod 契约。

### 5. 无关探针误伤限流

另一个本地项目持续请求 /archon，原全站限流导致正常任务查询收到 429。限流已经收紧到 /api，无关静态路径和 404 探针不会再占用业务 API 配额。当前 Memo 改用 3110 端口，避免争用 3100。

## 最终回归

- npm run typecheck：通过
- npm test：8 passed，1 个真实长测试默认 skipped
- npm run build：通过
- npm audit --audit-level=high：0 vulnerabilities
- /health：200
- /ready：200
- /terminal/：200
- /docs/openapi.yaml：200
- 登录、查询任务、查询内容：全部 200

## 密钥安全

- API Key 只保存在 backend/.env；
- .env 权限为 600；
- .env 已被 Git 忽略；
- 请求日志和测试输出没有打印真实 Token 或 API Key。
