import Foundation
import UIKit
import WebKit

@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    private weak var owner: PrototypeViewController?
    private let store: LibraryStore
    private let processor: ContentProcessor
    private let aiService: AIService
    private let authStore: AuthStore
    private var didApplyLaunchSetup = false
    private var processingItemIDs: Set<UUID> = []

    init(
        owner: PrototypeViewController,
        store: LibraryStore = .shared,
        processor: ContentProcessor = ContentProcessor(),
        aiService: AIService = .shared,
        authStore: AuthStore = .shared
    ) {
        self.owner = owner
        self.store = store
        self.processor = processor
        self.aiService = aiService
        self.authStore = authStore
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            replyHandler(nil, "无效的客户端请求")
            return
        }
        let payload = body["payload"] as? [String: Any] ?? [:]

        Task {
            do {
                let result = try await handle(action: action, payload: payload)
                replyHandler(result, nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        }
    }

    private func handle(
        action: String,
        payload: [String: Any]
    ) async throws -> Any {
        let publicActions: Set<String> = [
            "bootstrap",
            "completeOnboarding",
            "login",
            "register",
            "logout",
        ]
        if !publicActions.contains(action) {
            try await authStore.requireAuthentication()
        }

        switch action {
        case "bootstrap":
            if !didApplyLaunchSetup {
                didApplyLaunchSetup = true
                let environment = ProcessInfo.processInfo.environment
                if environment["KNOWLEDGE_RESET_ON_LAUNCH"] == "1" {
                    try await store.reset()
                }
                if environment["KNOWLEDGE_SKIP_ONBOARDING"] == "1" {
                    try await store.completeOnboarding()
                }
                if environment["KNOWLEDGE_RESET_AUTH_ON_LAUNCH"] == "1" {
                    await authStore.resetSession()
                }
            }
            let status = await aiService.modelStatus()
            let auth = await authStore.restoreSession()
            let snapshot = await store.snapshot(modelStatus: status, auth: auth)
            if auth.isAuthenticated {
                resumePendingProcessing(items: snapshot.items)
                return try jsonObject(snapshot)
            }
            return try jsonObject(
                AppSnapshot(
                    items: [],
                    conversations: [],
                    preferences: snapshot.preferences,
                    modelStatus: status,
                    auth: auth
                )
            )

        case "login":
            owner?.dismissKeyboard()
            return try jsonObject(
                try await authStore.login(
                    identifier: requiredString("identifier", in: payload),
                    password: requiredString("password", in: payload)
                )
            )

        case "register":
            owner?.dismissKeyboard()
            let nickname = (payload["nickname"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return try jsonObject(
                try await authStore.register(
                    identifier: requiredString("identifier", in: payload),
                    password: requiredString("password", in: payload),
                    nickname: nickname
                )
            )

        case "logout":
            await authStore.logout()
            return ["ok": true]

        case "addURL":
            let rawURL = try requiredString("url", in: payload)
            guard let url = URL(string: rawURL),
                  url.scheme?.lowercased().hasPrefix("http") == true else {
                throw BridgeError.invalidURL
            }
            let item = try await store.createPendingItem(url: url)
            startProcessing(item: item)
            return try jsonObject(item)

        case "items":
            return try jsonObject(await store.items())

        case "item":
            let itemID = try requiredUUID("itemID", in: payload)
            guard let item = await store.item(id: itemID) else {
                throw StoreError.itemNotFound
            }
            return try jsonObject(item)

        case "search":
            let query = payload["query"] as? String ?? ""
            let tags = payload["tags"] as? [String] ?? []
            return try jsonObject(await store.search(query: query, tags: tags))

        case "updateTags":
            let itemID = try requiredUUID("itemID", in: payload)
            let tags = payload["tags"] as? [String] ?? []
            let item = try await store.updateTags(itemID: itemID, tags: tags)
            emit(name: "itemUpdated", value: item)
            return try jsonObject(item)

        case "deleteItem":
            let itemID = try requiredUUID("itemID", in: payload)
            guard await confirmDeletion() else {
                return ["deleted": false]
            }
            try await store.remove(itemID: itemID)
            emit(name: "itemDeleted", object: ["itemID": itemID.uuidString])
            return ["deleted": true]

        case "toggleFavorite":
            let itemID = try requiredUUID("itemID", in: payload)
            let item = try await store.toggleFavorite(itemID: itemID)
            emit(name: "itemUpdated", value: item)
            return try jsonObject(item)

        case "retryItem":
            let itemID = try requiredUUID("itemID", in: payload)
            let item = try await store.retry(itemID: itemID)
            emit(name: "itemUpdated", value: item)
            startProcessing(item: item)
            return try jsonObject(item)

        case "completeOnboarding":
            try await store.completeOnboarding()
            return ["ok": true]

        case "share":
            let itemID = try requiredUUID("itemID", in: payload)
            guard let item = await store.item(id: itemID) else {
                throw StoreError.itemNotFound
            }
            presentShareSheet(item: item)
            return ["ok": true]

        case "openURL":
            let rawURL = try requiredString("url", in: payload)
            guard let url = URL(string: rawURL) else {
                throw BridgeError.invalidURL
            }
            await UIApplication.shared.open(url)
            return ["ok": true]

        case "showSettings":
            presentSettings()
            return ["ok": true]

        case "reset":
            try await store.reset()
            emit(name: "libraryReset", object: [:])
            return ["ok": true]

        default:
            throw BridgeError.unknownAction(action)
        }
    }

    private func startProcessing(item: KnowledgeItem) {
        let itemID = item.id
        let url = item.sourceURL
        guard processingItemIDs.insert(itemID).inserted else { return }
        Task {
            defer { processingItemIDs.remove(itemID) }
            do {
                let content = try await processor.process(
                    url: url,
                    idempotencyKey:
                        item.remoteIdempotencyKey ?? item.id.uuidString,
                    remoteTaskID: item.remoteTaskID,
                    onRemoteTaskCreated: { [store] taskID, sourceItemID in
                        if let updated = try? await store.attachRemoteTask(
                            itemID: itemID,
                            taskID: taskID,
                            sourceItemID: sourceItemID
                        ) {
                            await MainActor.run {
                                self.emit(
                                    name: "processingUpdated",
                                    value: updated
                                )
                            }
                        }
                    },
                    onProgress: { [store] stage in
                        let update: (
                            KnowledgeItemStatus,
                            Double,
                            String
                        )
                        switch stage {
                        case .fetching:
                            update = (.fetching, 0.18, "下载原始内容")
                        case .extracting:
                            update = (.extracting, 0.48, "提取正文内容")
                        case .enriching:
                            update = (.enriching, 0.76, "生成摘要和 Tag")
                        }
                        if let item = try? await store.updateProgress(
                            itemID: itemID,
                            status: update.0,
                            progress: update.1,
                            statusText: update.2
                        ) {
                            await MainActor.run {
                                self.emit(name: "processingUpdated", value: item)
                            }
                        }
                    }
                )
                let completed = try await store.complete(
                    itemID: itemID,
                    content: content
                )
                emit(name: "processingCompleted", value: completed)
            } catch {
                if let backendError = error as? VideoBackendError,
                   backendError == .connectionFailed ||
                    backendError == .taskTimedOut {
                    if let pending = try? await store.updateProgress(
                        itemID: itemID,
                        status: .extracting,
                        progress: 0.48,
                        statusText: "后台继续处理，稍后自动同步"
                    ) {
                        emit(name: "processingUpdated", value: pending)
                    }
                    return
                }
                let failed = try? await store.fail(
                    itemID: itemID,
                    message: error.localizedDescription
                )
                if let failed {
                    emit(name: "processingFailed", value: failed)
                }
            }
        }
    }

    func resumePendingProcessing() async {
        let auth = await authStore.restoreSession()
        guard auth.isAuthenticated else { return }
        let items = await store.items()
        resumePendingProcessing(items: items)
    }

    private func resumePendingProcessing(items: [KnowledgeItem]) {
        for item in items where [
            KnowledgeItemStatus.queued,
            .fetching,
            .extracting,
            .enriching,
        ].contains(item.status) {
            startProcessing(item: item)
        }
    }

    private func presentShareSheet(item: KnowledgeItem) {
        guard let owner else { return }
        let text = "\(item.title)\n\n\(item.summary)\n\n\(item.sourceURL.absoluteString)"
        let activity = UIActivityViewController(
            activityItems: [text, item.sourceURL],
            applicationActivities: nil
        )
        owner.present(activity, animated: true)
    }

    private func confirmDeletion() async -> Bool {
        guard let owner else { return false }
        return await withCheckedContinuation { continuation in
            let alert = UIAlertController(
                title: "删除这条收藏？",
                message: "摘要、Tag 和提取出的正文仍会从设备中移除。",
                preferredStyle: .alert
            )
            alert.addAction(
                UIAlertAction(title: "取消", style: .cancel) { _ in
                    continuation.resume(returning: false)
                }
            )
            alert.addAction(
                UIAlertAction(title: "删除", style: .destructive) { _ in
                    continuation.resume(returning: true)
                }
            )
            owner.present(alert, animated: true)
        }
    }

    private func presentSettings() {
        guard let owner else { return }
        let status = UIAlertController(
            title: "Memo 设置",
            message: """
            收藏结果、摘要、Tag 和搜索索引保存在设备上。你主动提交的视频链接会发送到 Memo 后端，由后端提取音频并调用云端模型生成转录和总结。
            """,
            preferredStyle: .actionSheet
        )
        status.addAction(
            UIAlertAction(title: "隐私说明", style: .default) { _ in
                self.presentPrivacyNotice()
            }
        )
        status.addAction(
            UIAlertAction(title: "清空本机全部数据", style: .destructive) { _ in
                self.confirmReset()
            }
        )
        status.addAction(
            UIAlertAction(title: "退出登录", style: .destructive) { _ in
                Task {
                    await self.authStore.logout()
                    self.emit(name: "loggedOut", object: [:])
                }
            }
        )
        status.addAction(UIAlertAction(title: "取消", style: .cancel))
        owner.present(status, animated: true)
    }

    private func presentPrivacyNotice() {
        guard let owner else { return }
        let notice = UIAlertController(
            title: "隐私说明",
            message: """
            Memo 使用手机号或邮箱账号验证身份，不接入广告、追踪或第三方分析 SDK。

            首次使用会自动创建匿名游客账号，登录令牌保存在系统 Keychain。只有你主动提交的视频链接和处理所需音频会发送到 Memo 后端与云端模型；结果同时保存在后端账号和设备受保护存储中。
            """,
            preferredStyle: .alert
        )
        notice.addAction(UIAlertAction(title: "知道了", style: .default))
        owner.present(notice, animated: true)
    }

    private func confirmReset() {
        guard let owner else { return }
        let alert = UIAlertController(
            title: "确定清空全部数据？",
            message: "此操作无法撤销。",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(
            UIAlertAction(title: "清空", style: .destructive) { _ in
                Task {
                    try? await self.store.reset()
                    self.emit(name: "libraryReset", object: [:])
                }
            }
        )
        owner.present(alert, animated: true)
    }

    private func requiredString(
        _ key: String,
        in payload: [String: Any]
    ) throws -> String {
        guard let value = payload[key] as? String,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BridgeError.missingField(key)
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func requiredUUID(
        _ key: String,
        in payload: [String: Any]
    ) throws -> UUID {
        guard let value = payload[key] as? String,
              let id = UUID(uuidString: value) else {
            throw BridgeError.missingField(key)
        }
        return id
    }

    private func jsonObject<T: Encodable>(_ value: T) throws -> Any {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(value)
        return try JSONSerialization.jsonObject(with: data)
    }

    private func emit<T: Encodable>(name: String, value: T) {
        guard let object = try? jsonObject(value) else { return }
        emit(name: name, object: object)
    }

    private func emit(name: String, object: Any) {
        owner?.sendNativeEvent(name: name, payload: object)
    }
}

enum BridgeError: LocalizedError {
    case invalidURL
    case missingField(String)
    case unknownAction(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "请输入有效链接"
        case .missingField(let field):
            "缺少必要参数：\(field)"
        case .unknownAction(let action):
            "不支持的操作：\(action)"
        }
    }
}
