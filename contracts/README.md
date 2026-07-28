# Memo API Contracts

`contracts/` 是 iOS、后端和测试共享的接口事实源。

- `openapi/memo-v1.yaml`：v1 HTTP API 契约。
- `fixtures/v1/`：前端 Mock 与后端 Contract Test 共用的成功、失败和状态样例。

规则：

1. 新字段先更新 OpenAPI 和 Fixture，再修改 iOS 与后端。
2. v1 只允许向后兼容扩展；破坏性变化进入新版本。
3. UI 使用 Domain Model，不直接依赖服务端 DTO。
4. 后端 Schema、集成测试和 iOS DTO 必须与这里的状态枚举一致。
