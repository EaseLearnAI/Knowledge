# Memo Knowledge Backend

基于 Node.js、Express、MongoDB/Mongoose 的 Memo 后端。提供账号认证、视频/音频解析任务、带时间戳转录、承接文案、任务日志和 Web 调试终端。

## 已实现

- 注册、登录、访问令牌、刷新令牌轮换、退出和当前用户；
- 基于 `installationId` 的无感游客会话，首屏不强制登录；
- YouTube、B站、抖音、小红书链接入队；
- 本地 MP4/MOV/WebM/MP3/M4A/WAV 上传；
- B站公开播放器 API 解析：不依赖 Chrome、Cookie 或开发者电脑；
- 火山大模型录音文件识别：`volc.bigasr.auc` submit/query、句级时间戳、瞬时故障重试；
- 火山方舟结构化总结；
- 长逐字稿 Map-Reduce 总结、JSON 自动修复与模型额度自动降级；
- 串行视频任务队列和服务重启后的任务恢复；
- 一句话摘要、观看价值、关键观点、章节、行动项、Tag 和 Markdown 文案；
- MiniMax OpenAI 兼容文案适配器，默认模型 `MiniMax-M3`；
- MiniMax M3 图文/短视频多模态理解：小红书和抖音图文直接读正文与图片，
  3 分钟内视频直接读完整画面，技术失败自动回退 ASR；
- MongoDB 任务和内容持久化、幂等键、软删除；
- JSON 日志、请求 ID、任务 SSE 和 `/terminal` Web 终端；
- Zod 输入校验、统一成功/失败结构、限流、Helmet 和 CORS；
- OpenAPI、中文接口文档、前端接入和方案总结。

## 启动

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

MongoDB 已使用明确数据库名：

```text
mongodb://localhost:27017/memo_knowledge
```

如果本机没有 MongoDB，可以先安装并启动：

```bash
brew install mongodb-community
brew services start mongodb-community
```

启动后：

- API：`http://127.0.0.1:3100`
- Web 终端：`http://127.0.0.1:3100/terminal`
- OpenAPI：`http://127.0.0.1:3100/docs/openapi.yaml`

## 验证

```bash
npm run typecheck
npm test
RUN_REAL_VIDEO_TEST=1 npx vitest run tests/real-local-video.test.ts
npm run smoke
npm run build
```

常规测试使用临时 MongoDB 和 Mock 视频源，速度快且可重复；`real-local-video`
只保留为开发诊断，不属于生产链路。

## 生产转写与总结

当前最小上线配置：

```dotenv
VIDEO_PROCESSOR=volc_asr
COPYWRITER_PROVIDER=ark
PUBLIC_BASE_URL=https://你的后端域名
MEDIA_PROXY_TTL_SECONDS=14400
VOLC_ASR_APP_ID=从运行环境注入，不要提交
VOLC_ASR_ACCESS_TOKEN=从运行环境注入，不要提交
VOLC_ASR_RESOURCE_ID=volc.bigasr.auc
VOLC_ASR_TIMEOUT_MS=10800000
VOLC_ASR_MAX_ATTEMPTS=3
ARK_API_KEY=从运行环境注入，不要提交
ARK_SUMMARY_MODEL=ep-replace-with-ark-endpoint-id
ARK_SUMMARY_FALLBACK_MODELS=
```

未启用 M3 多模态时，生产模式会强制要求 `volc_asr + ark`；启用多模态时要求
`volc_asr + minimax`，并校验 MiniMax Key。两种模式都禁止本地 Whisper、Mock 或
本地模拟总结。

处理流程：

```text
视频链接
→ B站公开 player API / 其他平台 yt-dlp 解析器
→ B站生成 HMAC 限时代理 URL
→ 云服务器代理音频流，不落盘
→ 火山服务端拉取音频
→ volc.bigasr.auc 云端长音频转写
→ 句级时间戳和完整逐字稿
→ 方舟 Responses API 结构化总结
→ MongoDB 保存结果
```

方舟 Key 与豆包语音 APP ID / Access Token 是两套凭据。B站公开内容由后端直接
调用公开播放器 API，再经带 HMAC 和过期时间的代理流交给火山，不使用浏览器
Cookie；小红书、抖音触发平台登录风控时，
生产服务器只能通过 `VIDEO_COOKIE_FILE` 挂载受控 Cookie 密钥。生产模式会拒绝
`VIDEO_COOKIE_BROWSER=chrome`，避免上线后误依赖开发者电脑。

火山标准版支持 5 小时以内、512 MB 以内的录音文件。代码使用 3 小时超时窗口，
并对网络抖动、限流和服务繁忙执行指数退避重试。火山 request ID 会写入 MongoDB
任务日志；服务重启后继续查询原任务，不会重复提交和计费。

`PUBLIC_BASE_URL` 在生产环境必须是公网 HTTPS 地址。它只暴露有时效签名的 B站
音频代理，不暴露任意 URL 抓取能力；代理会重新解析最新 CDN 地址并透传 Range，
因此不依赖短期 CDN URL 在整个任务周期内持续有效。

4 小时 37 分 52 秒的真实 B站公开视频已完成端到端验收：云 ASR 返回 75,673 字、
3,102 个句级时间段；5 段 Map-Reduce 总结全部成功，最终得到 6 条关键观点和 7 个
章节。该验收复用了已完成的火山 request ID，证明后端重启后不会重复提交 ASR。

游客会话：

```http
POST /api/v1/auth/guest
Content-Type: application/json

{"installationId":"67ee89ba-7050-4c04-a3d7-ac61a63499b3"}
```

同一个 `installationId` 会返回同一个游客用户，但每次都会轮换出新的访问令牌和刷新令牌。

## MiniMax 文案

默认 `COPYWRITER_PROVIDER=local`，无需 API Key，接口可完整运行。需要更高质量的深度文案时：

```dotenv
COPYWRITER_PROVIDER=minimax
MINIMAX_API_KEY=你的密钥
MINIMAX_API_BASE=https://api.minimaxi.com
MINIMAX_MODEL=MiniMax-M3
```

`MINIMAX_MODEL` 是独立配置项。以后在 MiniMax 同一 OpenAI 兼容接口内更换模型时，只需修改该值并重启服务，不需要改任务队列、路由或文案业务代码。若要换成其他厂商，则新增一个实现 `Copywriter` 接口的 Provider，并在 `src/app.ts` 选择即可。

### M3 图文与短视频分流

```dotenv
VIDEO_PROCESSOR=volc_asr
COPYWRITER_PROVIDER=minimax
MINIMAX_MULTIMODAL_ENABLED=true
MINIMAX_SHORT_VIDEO_MAX_SECONDS=180
MINIMAX_VIDEO_DETAIL=default
MINIMAX_VIDEO_FPS=1
MINIMAX_MEDIA_MAX_BYTES=49000000
```

处理策略：

```text
小红书/抖音图文 → 解析正文和图片 → 临时 TOS 签名 URL → MiniMax-M3
三平台 ≤ 180 秒视频 → 下载并压缩/合并为临时 MP4 → MiniMax-M3
三平台 > 180 秒视频 → 现有音频解析与 ASR → MiniMax-M3 文本总结
M3 媒体、网络或结构错误 → 短视频自动回退现有 ASR
```

M3 的 URL/Base64 视频上限为 50 MB，因此短视频会压缩到
`MINIMAX_MEDIA_MAX_BYTES` 以下。临时本地文件和 TOS 对象在模型请求结束后删除。
图文不回退音频链路；平台没有返回公开图片时会给出明确错误。生产服务器不运行
浏览器，平台登录态仍通过受控 `VIDEO_COOKIE_FILE` 挂载。

请不要把 `.env` 提交到 Git。

## 文档

- [完整 API 文档](./api.md)
- [OpenAPI 3.1](./docs/openapi.yaml)
- [前端接入指南](./docs/前端接入指南.md)
- [视频解析方案与改进总结](./docs/视频解析方案与改进总结.md)
