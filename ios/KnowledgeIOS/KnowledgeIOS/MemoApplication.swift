import Foundation

@MainActor
final class MemoApplication {
    enum Destination {
        case authentication
        case onboarding
        case library
    }

    private let store: LibraryStore
    private let authStore: AuthStore
    private let processor: ContentProcessor
    private let aiService: AIService
    private let environment: [String: String]

    private var didApplyLaunchSetup = false
    private var shouldResetLibraryOnNextAuth = false
    private var shouldSkipOnboardingOnNextAuth = false
    private var itemObservers: [
        UUID: [UUID: (KnowledgeItem) -> Void]
    ] = [:]

    private(set) var auth = AuthSnapshot(isAuthenticated: false, user: nil)
    private(set) var items: [KnowledgeItem] = []
    private(set) var preferences = AppPreferences()
    private(set) var modelStatus = "本地模式"

    var onLibraryChanged: (([KnowledgeItem]) -> Void)?

    init(
        store: LibraryStore = .shared,
        authStore: AuthStore = .shared,
        processor: ContentProcessor = ContentProcessor(),
        aiService: AIService = .shared,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) {
        self.store = store
        self.authStore = authStore
        self.processor = processor
        self.aiService = aiService
        self.environment = environment
    }

    var requestedScreenID: String {
        environment["KNOWLEDGE_SCREEN"] ?? "01-home"
    }

    func bootstrap() async -> Destination {
        if !didApplyLaunchSetup {
            didApplyLaunchSetup = true
            shouldResetLibraryOnNextAuth =
                environment["KNOWLEDGE_RESET_ON_LAUNCH"] == "1"
            shouldSkipOnboardingOnNextAuth =
                environment["KNOWLEDGE_SKIP_ONBOARDING"] == "1"
            if environment["KNOWLEDGE_RESET_AUTH_ON_LAUNCH"] == "1" {
                await authStore.resetSession()
            }
        }

        modelStatus = await aiService.modelStatus()
        auth = await authStore.restoreSession()
        return await prepareAuthenticatedLibrary()
    }

    func login(identifier: String, password: String) async throws -> Destination {
        auth = try await authStore.login(
            identifier: identifier,
            password: password
        )
        return await prepareAuthenticatedLibrary()
    }

    func register(
        nickname: String,
        identifier: String,
        password: String
    ) async throws -> Destination {
        auth = try await authStore.register(
            identifier: identifier,
            password: password,
            nickname: nickname
        )
        return await prepareAuthenticatedLibrary()
    }

    func completeOnboarding() async throws {
        try await store.completeOnboarding()
        preferences.hasCompletedOnboarding = true
    }

    func logout() async {
        await authStore.logout()
        try? await store.deactivate()
        auth = AuthSnapshot(isAuthenticated: false, user: nil)
        items = []
        preferences = AppPreferences()
        publishLibrary()
    }

    func changePassword(
        currentPassword: String,
        newPassword: String
    ) async throws {
        auth = try await authStore.changePassword(
            currentPassword: currentPassword,
            newPassword: newPassword
        )
    }

    func deleteAccount(currentPassword: String) async throws {
        guard let ownerID = auth.user?.id else {
            throw MemoApplicationError.authenticationRequired
        }
        try await authStore.deleteAccount(currentPassword: currentPassword)
        try await store.deleteProfile(ownerID: ownerID)
        auth = AuthSnapshot(isAuthenticated: false, user: nil)
        items = []
        preferences = AppPreferences()
        publishLibrary()
    }

    func addURL(_ rawValue: String) async throws -> KnowledgeItem {
        try await authStore.requireAuthentication()
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else {
            throw MemoApplicationError.invalidURL
        }
        let item = try await store.createPendingItem(url: url)
        await refreshItems()
        startProcessing(item)
        return item
    }

    func item(id: UUID) async -> KnowledgeItem? {
        await store.item(id: id)
    }

    func search(query: String) async -> [KnowledgeItem] {
        await store.search(query: query)
    }

    func updateTags(itemID: UUID, tags: [String]) async throws -> KnowledgeItem {
        let item = try await store.updateTags(itemID: itemID, tags: tags)
        await refreshItems()
        notifyItem(item)
        return item
    }

    func toggleFavorite(itemID: UUID) async throws -> KnowledgeItem {
        let item = try await store.toggleFavorite(itemID: itemID)
        await refreshItems()
        notifyItem(item)
        return item
    }

    func remove(itemID: UUID) async throws {
        try await store.remove(itemID: itemID)
        await refreshItems()
    }

    func retry(itemID: UUID) async throws -> KnowledgeItem {
        let item = try await store.retry(itemID: itemID)
        await refreshItems()
        startProcessing(item)
        return item
    }

    @discardableResult
    func observeItem(
        id: UUID,
        handler: @escaping (KnowledgeItem) -> Void
    ) -> UUID {
        let token = UUID()
        itemObservers[id, default: [:]][token] = handler
        return token
    }

    func stopObservingItem(id: UUID, token: UUID) {
        itemObservers[id]?.removeValue(forKey: token)
        if itemObservers[id]?.isEmpty == true {
            itemObservers.removeValue(forKey: id)
        }
    }

    func refreshItems() async {
        items = await store.items()
        publishLibrary()
    }

    private func prepareAuthenticatedLibrary() async -> Destination {
        guard auth.isAuthenticated, let user = auth.user else {
            try? await store.deactivate()
            items = []
            preferences = AppPreferences()
            publishLibrary()
            return .authentication
        }

        do {
            try await store.activate(ownerID: user.id)
            if shouldResetLibraryOnNextAuth {
                try await store.reset()
                shouldResetLibraryOnNextAuth = false
            }
            if shouldSkipOnboardingOnNextAuth {
                try await store.completeOnboarding()
                shouldSkipOnboardingOnNextAuth = false
            }
        } catch {
            items = []
            preferences = AppPreferences()
            return .library
        }

        let snapshot = await store.snapshot(modelStatus: modelStatus, auth: auth)
        items = snapshot.items
        preferences = snapshot.preferences
        publishLibrary()
        return preferences.hasCompletedOnboarding ? .library : .onboarding
    }

    private func startProcessing(_ item: KnowledgeItem) {
        let itemID = item.id
        let sourceURL = item.sourceURL
        let idempotencyKey = item.remoteIdempotencyKey ?? UUID().uuidString
        let remoteTaskID = item.remoteTaskID
        Task { [processor, store] in
            do {
                let content = try await processor.process(
                    url: sourceURL,
                    idempotencyKey: idempotencyKey,
                    remoteTaskID: remoteTaskID,
                    onRemoteTaskCreated: { taskID, sourceItemID in
                        if let item = try? await store.attachRemoteTask(
                            itemID: itemID,
                            taskID: taskID,
                            sourceItemID: sourceItemID
                        ) {
                            await self.receiveProcessingUpdate(item)
                        }
                    },
                    onProgress: { stage in
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
                            await self.receiveProcessingUpdate(item)
                        }
                    }
                )
                let completed = try await store.complete(
                    itemID: itemID,
                    content: content
                )
                await receiveProcessingUpdate(completed)
            } catch {
                if let failed = try? await store.fail(
                    itemID: itemID,
                    message: error.localizedDescription
                ) {
                    await receiveProcessingUpdate(failed)
                }
            }
        }
    }

    private func receiveProcessingUpdate(_ item: KnowledgeItem) async {
        items = await store.items()
        publishLibrary()
        notifyItem(item)
    }

    private func notifyItem(_ item: KnowledgeItem) {
        itemObservers[item.id]?.values.forEach { $0(item) }
    }

    private func publishLibrary() {
        onLibraryChanged?(items)
    }
}

enum MemoApplicationError: LocalizedError {
    case invalidURL
    case authenticationRequired

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "请输入有效的 http 或 https 链接"
        case .authenticationRequired:
            "请先登录"
        }
    }
}
