import Foundation

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
