import Foundation

@MainActor
protocol LibraryFeatureService: AnyObject {
    func search(query: String) async -> [KnowledgeItem]
    func updateTags(itemID: UUID, tags: [String]) async throws -> KnowledgeItem
    func toggleFavorite(itemID: UUID) async throws -> KnowledgeItem
    func remove(itemID: UUID) async throws

    @discardableResult
    func observeItem(
        id: UUID,
        handler: @escaping (KnowledgeItem) -> Void
    ) -> UUID

    func stopObservingItem(id: UUID, token: UUID)
}

extension MemoApplication: LibraryFeatureService {}
