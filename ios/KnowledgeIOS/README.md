# Memo iOS

Memo 使用 UIKit 原生实现注册登录、引导、收藏列表、添加、处理进度、搜索、
详情、Tag 编辑、侧边栏与账号设置。App 不打包 HTML、JavaScript 或 WKWebView
页面。

## 打开

```bash
cd ios/KnowledgeIOS
xcodegen generate
open KnowledgeIOS.xcodeproj
```

默认 Scheme：`KnowledgeIOS`。

## UI 测试状态直达

运行或 UI 测试时可设置 `KNOWLEDGE_SCREEN`：

- `01-home`：收藏首页；
- `03-add`：原生添加页；
- `08-search`：原生搜索页；
- `04-detail-podcast` / `06-detail-article`：首条收藏详情；
- `07-processing`：首条处理中收藏；
- `11-edit-tags`：首条收藏的 Tag 编辑。

未设置时默认进入原生收藏首页。
