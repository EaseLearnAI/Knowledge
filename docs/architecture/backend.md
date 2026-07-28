# 后端架构

## 目录

```text
src/
├── bootstrap/
│   ├── create-container.ts
│   ├── create-http-app.ts
│   ├── create-worker.ts
│   ├── server.ts
│   └── worker.ts
├── modules/
│   ├── auth/{application,adapters}
│   ├── capture/{application,adapters}
│   ├── library/{application,adapters}
│   ├── processing/{domain,application,adapters}
│   └── operations/
├── integrations/
│   ├── analysis/
│   ├── generation/
│   ├── media/
│   └── transcription/
└── platform/
    ├── config/
    ├── database/
    ├── http/
    ├── observability/
    └── security/
```

## 启动与装配

- `create-container.ts` 是唯一 Provider 选择与依赖装配入口。
- `create-http-app.ts` 只组装 Express 中间件和模块路由。
- `create-worker.ts` 单独组装任务执行器，Worker 不再为了处理队列创建 HTTP App。
- `server.ts` 与 `worker.ts` 只负责进程生命周期、数据库连接和优雅退出。

## 模块边界

- `auth`：用户、会话、令牌轮换与账号生命周期。
- `capture`：创建幂等采集任务、查询任务和任务事件。
- `library`：内容列表、详情、Tag、收藏与删除。
- `processing`：任务状态机、执行队列和持久化模型。
- `operations`：健康检查与调试终端。

外部媒体下载、对象存储、ASR 和模型实现位于 `integrations`，通过 processing domain 中的接口接入；它们不引用 Express 路由。

## 契约

机器可读契约位于 `contracts/openapi/memo-v1.yaml`。后端继续通过 `/docs/openapi.yaml` 提供该文件，避免破坏既有客户端和调试工具。
