import CryptoKit
import Foundation

actor LibraryStore {
    static let shared = LibraryStore()

    private struct PersistedState: Codable {
        var items: [KnowledgeItem] = []
        var preferences = AppPreferences()
    }

    private let directoryURL: URL
    private let legacyStateURL: URL
    private var activeOwnerID: String?
    private var state = PersistedState()

    init(fileManager: FileManager = .default) {
        let baseURL = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? fileManager.temporaryDirectory
        let memoDirectoryURL = baseURL.appendingPathComponent(
            "Memo",
            isDirectory: true
        )
        directoryURL = memoDirectoryURL
        legacyStateURL = memoDirectoryURL.appendingPathComponent("library.json")
        try? fileManager.createDirectory(
            at: memoDirectoryURL,
            withIntermediateDirectories: true
        )
    }

    func activate(ownerID: String) throws {
        guard activeOwnerID != ownerID else { return }
        if activeOwnerID != nil {
            try persist()
        }
        activeOwnerID = ownerID
        let profileURL = stateURL(for: ownerID)
        if let data = try? Data(contentsOf: profileURL),
           let decoded = try? Self.decoder.decode(PersistedState.self, from: data) {
            state = decoded
            return
        }

        if let data = try? Data(contentsOf: legacyStateURL),
           let decoded = try? Self.decoder.decode(PersistedState.self, from: data) {
            state = decoded
            try persist()
            try? FileManager.default.removeItem(at: legacyStateURL)
        } else {
            state = PersistedState()
        }
    }

    func deactivate() throws {
        if activeOwnerID != nil {
            try persist()
        }
        activeOwnerID = nil
        state = PersistedState()
    }

    func deleteProfile(ownerID: String) throws {
        if activeOwnerID == ownerID {
            activeOwnerID = nil
            state = PersistedState()
        }
        let profileURL = stateURL(for: ownerID)
        if FileManager.default.fileExists(atPath: profileURL.path) {
            try FileManager.default.removeItem(at: profileURL)
        }
    }

    func snapshot() -> LibrarySnapshot {
        LibrarySnapshot(
            items: state.items.sorted { $0.createdAt > $1.createdAt },
            preferences: state.preferences
        )
    }

    func createPendingItem(url: URL) throws -> KnowledgeItem {
        guard !state.items.contains(where: { $0.sourceURL == url }) else {
            throw StoreError.duplicateURL
        }

        let now = Date()
        let item = KnowledgeItem(
            id: UUID(),
            sourceURL: url,
            kind: .article,
            sourceName: url.host() ?? "网页",
            title: url.absoluteString,
            summary: "",
            content: "",
            keyPoints: [],
            tags: [],
            isFavorite: false,
            status: .queued,
            progress: 0,
            statusText: "等待处理",
            errorMessage: nil,
            remoteTaskID: nil,
            remoteSourceItemID: nil,
            remoteIdempotencyKey: UUID().uuidString,
            createdAt: now,
            updatedAt: now
        )
        state.items.append(item)
        try persist()
        return item
    }

    func updateProgress(
        itemID: UUID,
        status: KnowledgeItemStatus,
        progress: Double,
        statusText: String,
        processingStartedAt: Date?
    ) throws -> KnowledgeItem {
        guard let index = state.items.firstIndex(where: { $0.id == itemID }) else {
            throw StoreError.itemNotFound
        }
        state.items[index].status = status
        state.items[index].progress = progress
        state.items[index].statusText = statusText
        if let processingStartedAt {
            state.items[index].processingStartedAt = processingStartedAt
        }
        state.items[index].updatedAt = Date()
        try persist()
        return state.items[index]
    }

    func attachRemoteTask(
        itemID: UUID,
        taskID: String,
        sourceItemID: String
    ) throws -> KnowledgeItem {
        guard let index = state.items.firstIndex(where: { $0.id == itemID }) else {
            throw StoreError.itemNotFound
        }
        state.items[index].remoteTaskID = taskID
        state.items[index].remoteSourceItemID = sourceItemID
        state.items[index].updatedAt = Date()
        try persist()
        return state.items[index]
    }

    func complete(itemID: UUID, content: ProcessedContent) throws -> KnowledgeItem {
        guard let index = state.items.firstIndex(where: { $0.id == itemID }) else {
            throw StoreError.itemNotFound
        }
        state.items[index].kind = content.kind
        state.items[index].sourceName = content.sourceName
        state.items[index].title = content.title
        state.items[index].summary = content.enrichment.summary
        state.items[index].whyWorthWatching = content.enrichment.whyWorthWatching
        state.items[index].content = content.content
        state.items[index].keyPoints = content.enrichment.keyPoints
        state.items[index].tags = content.enrichment.tags
        state.items[index].status = .ready
        state.items[index].progress = 1
        state.items[index].statusText = "处理完成"
        state.items[index].errorMessage = nil
        state.items[index].processingStartedAt = nil
        state.items[index].remoteTaskID = nil
        state.items[index].remoteIdempotencyKey = UUID().uuidString
        state.items[index].updatedAt = Date()
        try persist()
        return state.items[index]
    }

    func fail(itemID: UUID, message: String) throws -> KnowledgeItem {
        guard let index = state.items.firstIndex(where: { $0.id == itemID }) else {
            throw StoreError.itemNotFound
        }
        state.items[index].status = .failed
        state.items[index].statusText = "处理失败"
        state.items[index].errorMessage = message
        state.items[index].updatedAt = Date()
        try persist()
        return state.items[index]
    }

    func item(id: UUID) -> KnowledgeItem? {
        state.items.first { $0.id == id }
    }

    func items() -> [KnowledgeItem] {
        state.items.sorted { $0.createdAt > $1.createdAt }
    }

    func search(query: String, tags: [String] = []) -> [KnowledgeItem] {
        let terms = query
            .lowercased()
            .split(whereSeparator: \.isWhitespace)
            .map(String.init)
        return state.items
            .filter { $0.status == .ready }
            .filter { item in
                let matchesTerms = terms.isEmpty ||
                    terms.allSatisfy { item.searchText.contains($0) }
                let matchesTags = tags.isEmpty ||
                    !Set(item.tags).isDisjoint(with: tags)
                return matchesTerms && matchesTags
            }
            .sorted { lhs, rhs in
                score(lhs, terms: terms) > score(rhs, terms: terms)
            }
    }

    func updateTags(itemID: UUID, tags: [String]) throws -> KnowledgeItem {
        guard let index = state.items.firstIndex(where: { $0.id == itemID }) else {
            throw StoreError.itemNotFound
        }
        state.items[index].tags = Array(
            Set(tags.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) })
        )
        .filter { !$0.isEmpty }
        .sorted()
        state.items[index].updatedAt = Date()
        try persist()
        return state.items[index]
    }

    func toggleFavorite(itemID: UUID) throws -> KnowledgeItem {
        guard let index = state.items.firstIndex(where: { $0.id == itemID }) else {
            throw StoreError.itemNotFound
        }
        state.items[index].isFavorite.toggle(defaultingTo: false)
        state.items[index].updatedAt = Date()
        try persist()
        return state.items[index]
    }

    func retry(itemID: UUID) throws -> KnowledgeItem {
        guard let index = state.items.firstIndex(where: { $0.id == itemID }) else {
            throw StoreError.itemNotFound
        }
        state.items[index].status = .queued
        state.items[index].progress = 0
        state.items[index].statusText = "等待重试"
        state.items[index].errorMessage = nil
        state.items[index].processingStartedAt = nil
        state.items[index].remoteTaskID = nil
        state.items[index].remoteSourceItemID = nil
        state.items[index].remoteIdempotencyKey = UUID().uuidString
        state.items[index].updatedAt = Date()
        try persist()
        return state.items[index]
    }

    func remove(itemID: UUID) throws {
        guard let index = state.items.firstIndex(where: { $0.id == itemID }) else {
            throw StoreError.itemNotFound
        }
        state.items.remove(at: index)
        try persist()
    }

    func completeOnboarding() throws {
        state.preferences.hasCompletedOnboarding = true
        try persist()
    }

    func reset() throws {
        state = PersistedState()
        try persist()
    }

    private func score(_ item: KnowledgeItem, terms: [String]) -> Int {
        terms.reduce(into: 0) { score, term in
            if item.title.lowercased().contains(term) { score += 8 }
            if item.tags.joined(separator: " ").lowercased().contains(term) {
                score += 5
            }
            if item.summary.lowercased().contains(term) { score += 3 }
            if item.content.lowercased().contains(term) { score += 1 }
        }
    }

    private func persist() throws {
        guard let activeOwnerID else { return }
        let data = try Self.encoder.encode(state)
        try data.write(
            to: stateURL(for: activeOwnerID),
            options: [.atomic, .completeFileProtection]
        )
    }

    private func stateURL(for ownerID: String) -> URL {
        let digest = SHA256.hash(data: Data(ownerID.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return directoryURL.appendingPathComponent(
            "library-\(digest.prefix(24)).json"
        )
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

private extension Optional where Wrapped == Bool {
    mutating func toggle(defaultingTo defaultValue: Bool) {
        self = !(self ?? defaultValue)
    }
}

enum StoreError: LocalizedError {
    case duplicateURL
    case itemNotFound

    var errorDescription: String? {
        switch self {
        case .duplicateURL:
            "这个链接已经收藏过了"
        case .itemNotFound:
            "没有找到对应的收藏"
        }
    }
}
