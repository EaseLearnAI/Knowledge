import XCTest
@testable import Memo

final class ArchitectureBoundaryTests: XCTestCase {
    func testSharedVideoURLParserAcceptsSupportedHosts() {
        let value = "看看这个 https://www.bilibili.com/video/BV1test"
        XCTAssertEqual(
            SharedVideoURLParser.extract(from: value)?.host(),
            "www.bilibili.com"
        )
    }

    func testSharedVideoURLParserRejectsUnsupportedHosts() {
        XCTAssertNil(
            SharedVideoURLParser.extract(from: "https://example.com/video")
        )
    }

    func testKnowledgeItemSearchTextIncludesDomainContent() {
        let item = KnowledgeItem(
            id: UUID(),
            sourceURL: URL(string: "https://www.bilibili.com/video/BV1test")!,
            kind: .video,
            sourceName: "B 站",
            title: "架构重组",
            summary: "组件化摘要",
            content: "依赖倒置",
            keyPoints: ["契约优先"],
            tags: ["iOS"],
            isFavorite: false,
            status: .ready,
            progress: 1,
            statusText: "处理完成",
            errorMessage: nil,
            remoteTaskID: nil,
            remoteSourceItemID: nil,
            remoteIdempotencyKey: nil,
            createdAt: Date(),
            updatedAt: Date()
        )

        XCTAssertTrue(item.searchText.contains("架构重组"))
        XCTAssertTrue(item.searchText.contains("契约优先"))
        XCTAssertTrue(item.searchText.contains("ios"))
    }
}
