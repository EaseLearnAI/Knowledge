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

struct ChatCitation: Codable, Sendable {
    let itemID: UUID
    let number: Int
    let title: String
    let quote: String
    let sourceName: String
}

struct ChatMessage: Codable, Identifiable, Sendable {
    enum Role: String, Codable, Sendable {
        case user
        case assistant
    }

    let id: UUID
    let role: Role
    let content: String
    let citations: [ChatCitation]
    let createdAt: Date
}

struct Conversation: Codable, Identifiable, Sendable {
    let id: UUID
    var title: String
    var messages: [ChatMessage]
    let createdAt: Date
    var updatedAt: Date
}

struct AppPreferences: Codable, Sendable {
    var hasCompletedOnboarding = false
}

struct AppSnapshot: Codable, Sendable {
    let items: [KnowledgeItem]
    let conversations: [Conversation]
    let preferences: AppPreferences
    let modelStatus: String
    let auth: AuthSnapshot
}

struct ContentEnrichment: Sendable {
    let summary: String
    let whyWorthWatching: String?
    let keyPoints: [String]
    let tags: [String]
}

struct ProcessedContent: Sendable {
    let kind: KnowledgeItemKind
    let sourceName: String
    let title: String
    let content: String
    let enrichment: ContentEnrichment
}

enum ProcessingStage: Sendable {
    case fetching
    case extracting
    case enriching
}

struct ChatResponse: Codable, Sendable {
    let answer: String
    let citations: [ChatCitation]
    let conversation: Conversation
}
