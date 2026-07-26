# Memo Knowledge Backend

基于 Node.js、Express、MongoDB/Mongoose 的 Memo 后端。提供账号认证、视频/音频解析任务、带时间戳转录、承接文案、任务日志和 Web 调试终端。

## 已实现

- 注册、登录、访问令牌、刷新令牌轮换、退出和当前用户；
- 基于 `installationId` 的无感游客会话，首屏不强制登录；
- YouTube、B站、抖音、小红书链接入队；
- 本地 MP4/MOV/WebM/MP3/M4A/WAV 上传；
- 复用本机 `videosummarize`：下载、FFmpeg 抽音频、本地 Whisper 转录；
- 火山方舟音频理解：48kbps MP3、长音频按 4 分钟切片、Files API 临时上传、语音转写后主动删除；
- 火山录音文件识别适配器：支持 `volc.bigasr.auc` 的 submit/query 轮询和句级时间戳；
- 火山方舟结构化总结，可与音频转写共用一把 `ARK_API_KEY`；
- 串行视频任务队列，避免 Apple Silicon 多个 MLX 进程冲突；
- 一句话摘要、观看价值、关键观点、章节、行动项、Tag 和 Markdown 文案；
- MiniMax OpenAI 兼容文案适配器，默认模型 `MiniMax-M3`；
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

常规测试使用临时 MongoDB 和 Mock 视频源，速度快且可重复；真实测试会调用本机 FFmpeg 与 Whisper。

## 火山方舟转写与总结

当前最小上线配置：

```dotenv
VIDEO_PROCESSOR=ark
COPYWRITER_PROVIDER=ark
ARK_API_KEY=从运行环境注入，不要提交
ARK_AUDIO_MODEL=doubao-seed-2-0-lite-260428
ARK_SUMMARY_MODEL=doubao-seed-2-0-lite-260428
```

处理流程：

```text
视频链接
→ videosummarize 下载器
→ FFmpeg 生成 16kHz 单声道 48kbps MP3
→ 每 4 分钟切片并逐段上传方舟 Files API
→ Responses API 逐段转写并合并
→ Responses API 结构化总结
→ 删除方舟临时文件与本地工作目录
```

`ark-...` 格式的方舟 Key 适用于该路径。专用豆包语音 ASR 使用语音控制台的
APP ID 与 Access Token，不是同一种密钥；可切换为：

```dotenv
VIDEO_PROCESSOR=volc_asr
VOLC_ASR_APP_ID=从运行环境注入
VOLC_ASR_ACCESS_TOKEN=从运行环境注入
VOLC_ASR_RESOURCE_ID=volc.bigasr.auc
```

专用 ASR 由火山服务端主动拉取音频 URL。社交平台的临时 CDN 链接可能限制服务端
拉取，因此云服务器上线前应配合对象存储生成短期公开 URL；未配置对象存储时，
默认的 `ark` 分段上传路径更稳。
首次调用前，需要在火山方舟控制台开通
`doubao-seed-2-0-lite-260428` 模型。

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

请不要把 `.env` 提交到 Git。

## 文档

- [完整 API 文档](./api.md)
- [OpenAPI 3.1](./docs/openapi.yaml)
- [前端接入指南](./docs/前端接入指南.md)
- [视频解析方案与改进总结](./docs/视频解析方案与改进总结.md)
