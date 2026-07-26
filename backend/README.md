# Memo Knowledge Backend

基于 Node.js、Express、MongoDB/Mongoose 的 Memo 后端。提供账号认证、视频/音频解析任务、带时间戳转录、承接文案、任务日志和 Web 调试终端。

## 已实现

- 注册、登录、访问令牌、刷新令牌轮换、退出和当前用户；
- YouTube、B站、抖音、小红书链接入队；
- 本地 MP4/MOV/WebM/MP3/M4A/WAV 上传；
- 复用本机 `videosummarize`：下载、FFmpeg 抽音频、本地 Whisper 转录；
- 串行视频任务队列，避免 Apple Silicon 多个 MLX 进程冲突；
- 一句话摘要、观看价值、关键观点、章节、行动项、Tag 和 Markdown 文案；
- MiniMax OpenAI 兼容文案适配器，默认模型 `MiniMax-M3`；
- MongoDB 任务和内容持久化、幂等键、软删除；
- JSON 日志、请求 ID、任务 SSE 和 `/terminal` Web 终端；
- Zod 输入校验、统一成功/失败结构、限流、Helmet 和 CORS；
- OpenAPI、中文接口文档、前端接入和方案总结。

## 启动

```bash
cd /Users/mac/Desktop/test/Knowledge/backend
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
