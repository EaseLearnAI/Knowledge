import Foundation

enum KnowledgeItemKind: String, Codable, Sendable {
    case article
    case podcast
    case video
    case imagePost = "image_post"
    case note
}

enum KnowledgeItemStatus: String, Codable, Sendable {
    case queued
    case fetching
    case extracting
    case enriching
    case ready
    case failed
}

struct KnowledgeItem: Codable, Identifiable, Sendable {
    let id: UUID
    var sourceURL: URL
    var kind: KnowledgeItemKind
    var sourceName: String
    var title: String
    var summary: String
    var whyWorthWatching: String? = nil
    var content: String
    var keyPoints: [String]
    var tags: [String]
    var isFavorite: Bool?
    var status: KnowledgeItemStatus
    var progress: Double
    var statusText: String
    var errorMessage: String?
    var processingStartedAt: Date? = nil
    var remoteTaskID: String?
    var remoteSourceItemID: String?
    var remoteIdempotencyKey: String?
    let createdAt: Date
    var updatedAt: Date

    var searchText: String {
        ([title, summary, whyWorthWatching ?? "", content] + tags + keyPoints)
            .joined(separator: " ")
            .lowercased()
    }

    var favorite: Bool { isFavorite ?? false }
}
