# Memo · App Store 发布资料

## 基本信息

- App 名称：Memo
- 副标题：提取、分析并收藏内容
- Bundle ID：`ai.easelearn.knowledge`
- 版本：`1.0.0`（Build `1`）
- 主类别：效率
- 次类别：教育
- 年龄分级建议：4+
- 价格：免费
- 隐私政策 URL：<https://memo-privacy-support.dreamyyds.chatgpt.site>
- App 支持 URL：<https://memo-privacy-support.dreamyyds.chatgpt.site>

## 宣传文本

把值得记住的视频链接发进来。Memo 自动提取音频、生成摘要和 Tag，让收藏不再吃灰。

## 完整描述

Memo 是一个本地优先的视频知识收藏 App。

粘贴一条受支持的视频链接，Memo 会自动完成：

- 提取标题、音频、转录与来源信息
- 生成一句话摘要和关键观点
- 自动推荐 Tag，也支持手动调整
- 全文搜索标题、摘要、转录和 Tag

首次使用会自动创建匿名游客账号，不要求先注册登录。你主动提交的视频链接会发送到 Memo 后端，由后端提取音频并调用云端模型生成转录和总结；结果同步保存到账号和设备。Memo 不接入广告、跨 App 追踪或第三方分析 SDK。

## 关键词

知识管理,稍后阅读,网页收藏,AI摘要,全文搜索,笔记,第二大脑,Tag,本地优先

## App Review 备注

- App 首次启动自动创建游客会话，不强制展示注册登录；登录令牌保存在系统 Keychain。
- 主要流程：启动 App → 点击添加 → 粘贴受支持的视频链接 → 等待后端处理完成 → 查看摘要、关键观点、Tag 或搜索。
- 测试链接可使用：`https://example.com`
- 无付费墙、订阅或应用内购买。
- 无广告、追踪或第三方分析 SDK。
- 加密出口合规：仅使用 Apple 系统提供的标准 HTTPS 网络能力，`ITSAppUsesNonExemptEncryption = NO`。

## App Privacy 建议填写

接入生产认证服务后，应按实际上线的数据链路申报账号信息；不能继续选择 **Data Not Collected（不收集数据）**。

说明：

- 手机号或邮箱、昵称和密码哈希由认证服务处理；App 不保存明文密码。
- 登录令牌保存在系统 Keychain；主动提交的视频链接和音频由后端及云端模型处理，摘要和 Tag 同时保存在账号和用户设备。
- 用户主动收藏网页时，设备会直接请求来源网站；Memo 没有自有内容服务器。
- 不包含广告、分析、追踪或第三方数据 SDK。

## 上架前仍需由账号所有者填写

- Apple Developer Team / 签名证书
- App Store Connect 中的开发者联系信息
- 销售地区和价格
- 内容版权声明
- 最终截图排序与本地化
