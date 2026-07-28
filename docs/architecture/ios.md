# iOS 架构

## 目录

```text
KnowledgeIOS/
├── App/
│   ├── AppDelegate.swift
│   ├── AppCompositionRoot.swift
│   ├── MemoApplication.swift
│   └── MemoRootViewController.swift
├── Features/
│   ├── Auth/{Domain,Data,UI}
│   ├── Capture/{Domain,Data,UI}
│   ├── Library/{Domain,Data,UI}
│   ├── ContentDetail/UI
│   ├── Search/UI
│   ├── Onboarding/UI
│   └── Settings/UI
├── Shared/
│   ├── DesignSystem/{Foundation,Components,Feedback}
│   └── Utilities/
└── Resources/
```

## 装配方式

`AppDelegate` 只创建 `AppCompositionRoot`。组合根创建认证仓储、本地资料库、内容处理器与应用协调对象，再注入根控制器。页面不自行创建 API Client、Keychain、存储或处理 Provider。

## 关键协议

- `AuthRepository`：认证状态、登录会话与账号操作。
- `AuthTokenProviding`：采集网络层只获取访问令牌，不依赖完整认证实现。
- `LibraryFeatureService`：资料库、搜索、详情和 Tag 页面面向业务接口编程。

## 状态与持久化

- `MemoApplication` 是一期应用级协调器，不再承载 DTO、Keychain 或页面实现。
- `LibraryStore` 负责本地缓存与设备偏好。
- `ContentProcessor` 只负责采集、轮询和远端内容操作；旧 HTML 抓取及端侧 AI 问答链路已删除。
- 处理完成后保留 `remoteSourceItemID`，Tag、收藏、删除可同步到后端。

## 测试

- `KnowledgeIOSTests/ArchitectureBoundaryTests.swift`：领域搜索文本和共享 URL 解析接缝。
- `KnowledgeIOSUITests/KnowledgeIOSUITests.swift`：认证、引导、采集、持久化、详情、Tag、搜索、设置、可访问性与纯 UIKit 约束。
