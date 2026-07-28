import Foundation

@MainActor
final class MemoApplication {
    enum Destination {
        case authentication
        case onboarding
        case library
    }

    private let store: LibraryStore
    private let authRepository: any AuthRepository
    private let processor: ContentProcessor
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

    var onLibraryChanged: (([KnowledgeItem]) -> Void)?

    init(
        store: LibraryStore = .shared,
        authRepository: any AuthRepository = AuthStore.shared,
        processor: ContentProcessor = ContentProcessor(),
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) {
        self.store = store
        self.authRepository = authRepository
        self.processor = processor
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
                await authRepository.resetSession()
            }
        }

        auth = await authRepository.restoreSession()
        return await prepareAuthenticatedLibrary()
    }

    func login(identifier: String, password: String) async throws -> Destination {
        auth = try await authRepository.login(
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
        auth = try await authRepository.register(
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
        await authRepository.logout()
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
        auth = try await authRepository.changePassword(
            currentPassword: currentPassword,
            newPassword: newPassword
        )
    }

    func deleteAccount(currentPassword: String) async throws {
        guard let ownerID = auth.user?.id else {
            throw MemoApplicationError.authenticationRequired
        }
        try await authRepository.deleteAccount(currentPassword: currentPassword)
        try await store.deleteProfile(ownerID: ownerID)
        auth = AuthSnapshot(isAuthenticated: false, user: nil)
        items = []
        preferences = AppPreferences()
        publishLibrary()
    }

    func addURL(_ rawValue: String) async throws -> KnowledgeItem {
        try await authRepository.requireAuthentication()
        guard let url = SharedVideoURLParser.extract(from: rawValue) else {
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
        if let remoteID = await store.item(id: itemID)?.remoteSourceItemID {
            try await processor.updateRemoteItem(
                id: remoteID,
                tags: tags,
                isFavorite: nil
            )
        }
        let item = try await store.updateTags(itemID: itemID, tags: tags)
        await refreshItems()
        notifyItem(item)
        return item
    }

    func toggleFavorite(itemID: UUID) async throws -> KnowledgeItem {
        if let current = await store.item(id: itemID),
           let remoteID = current.remoteSourceItemID {
            try await processor.updateRemoteItem(
                id: remoteID,
                tags: nil,
                isFavorite: !current.favorite
            )
        }
        let item = try await store.toggleFavorite(itemID: itemID)
        await refreshItems()
        notifyItem(item)
        return item
    }

    func remove(itemID: UUID) async throws {
        if let remoteSourceItemID = await store.item(id: itemID)?.remoteSourceItemID {
            try await processor.deleteRemoteItem(id: remoteSourceItemID)
        }
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

        let snapshot = await store.snapshot()
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
                    onProgress: { stage, backendProgress in
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
                        let progress = backendProgress.map {
                            min(max($0 / 100, 0), 0.99)
                        } ?? update.1
                        if let item = try? await store.updateProgress(
                            itemID: itemID,
                            status: update.0,
                            progress: progress,
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
            "请粘贴包含有效 B站、抖音或小红书链接的分享内容"
        case .authenticationRequired:
            "请先登录"
        }
    }
}
