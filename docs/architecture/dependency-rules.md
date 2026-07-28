# 依赖规则

## iOS

允许：

```text
UI -> Feature Protocol/Domain
Data -> Domain
App Composition Root -> Feature concrete implementations
Feature -> Shared
```

禁止：

- Feature UI 直接创建 `URLSession`、Keychain 或文件存储。
- 一个 Feature 引用另一个 Feature 的具体 UI Controller。
- `Shared` 引用 Feature 类型。
- 把仅单页使用的 View 放入全局 Design System。

## 后端

允许：

```text
HTTP Adapter -> Application Service -> Domain Port
Mongo Adapter -> Domain/Application types
Bootstrap -> Modules + Integrations + Platform
Integration -> Processing domain contracts
```

禁止：

- Application Service 引用 Express Request/Response。
- Domain 引用 Mongoose、Pino 或环境变量。
- Integration 注册路由或选择运行环境 Provider。
- HTTP App 与 Worker 互相启动。

## 变更检查

新增功能前先判断归属：

1. 是产品用例，放 Feature/module。
2. 是外部系统实现，放 Data adapter/integration。
3. 是跨模块技术能力，且已有两个真实调用者，放 Shared/platform。
4. 只是装配或生命周期，放 App/bootstrap。
