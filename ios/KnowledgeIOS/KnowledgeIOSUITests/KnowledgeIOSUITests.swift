import XCTest

@MainActor
final class KnowledgeIOSUITests: XCTestCase {
    private let exampleURL = "https://example.com"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testFirstLaunchCompletesOnboardingAndShowsEmptyLibrary() {
        let app = launchApp(reset: true, skipOnboarding: false)
        let webView = app.webViews["prototype-webview"]
        XCTAssertTrue(webView.waitForExistence(timeout: 8))

        let nextButton = webView.buttons["下一步"]
        XCTAssertTrue(nextButton.waitForExistence(timeout: 5))
        nextButton.tap()
        XCTAssertTrue(
            webView.staticTexts.containing(
                NSPredicate(format: "label CONTAINS %@", "读完之后")
            ).firstMatch.waitForExistence(timeout: 3)
        )

        webView.buttons["下一步"].tap()
        XCTAssertTrue(
            webView.staticTexts.containing(
                NSPredicate(format: "label CONTAINS %@", "收藏越多")
            ).firstMatch.waitForExistence(timeout: 3)
        )

        let startButton = webView.buttons["开始使用"]
        XCTAssertTrue(startButton.waitForExistence(timeout: 3))
        startButton.tap()

        XCTAssertTrue(webView.buttons["添加第 1 条"].waitForExistence(timeout: 3))
    }

    func testRealURLIngestionPersistsAcrossRelaunch() {
        var app = launchApp(
            screenID: "03-add",
            reset: true,
            skipOnboarding: true
        )
        let webView = app.webViews["prototype-webview"]
        XCTAssertTrue(webView.waitForExistence(timeout: 8))

        let urlField = webView.textViews["内容链接"]
        XCTAssertTrue(urlField.waitForExistence(timeout: 5))
        urlField.tap()
        urlField.typeText(exampleURL)
        dismissKeyboard(in: app)

        let collectButton = webView.buttons["收藏到 Memo"]
        XCTAssertTrue(collectButton.waitForExistence(timeout: 3))
        collectButton.tap()

        XCTAssertTrue(
            webView.staticTexts["Example Domain"].waitForExistence(timeout: 30)
        )

        app.terminate()
        app = launchApp(reset: false, skipOnboarding: true)
        XCTAssertTrue(
            app.webViews["prototype-webview"]
                .staticTexts["Example Domain"]
                .waitForExistence(timeout: 8)
        )
    }

    func testSearchOpensRealSavedResult() {
        var app = launchAndIngestExample()
        app.terminate()
        app = launchApp(reset: false, skipOnboarding: true)
        let webView = app.webViews["prototype-webview"]
        XCTAssertTrue(webView.waitForExistence(timeout: 8))

        let searchButton = webView.buttons["搜索"]
        XCTAssertTrue(searchButton.waitForExistence(timeout: 5))
        searchButton.tap()

        let searchField = webView.textFields["搜索收藏"]
        XCTAssertTrue(searchField.waitForExistence(timeout: 5))
        searchField.tap()
        searchField.typeText("Example")

        let result = webView.buttons["Example Domain"]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        XCTAssertTrue(webView.staticTexts["Example Domain"].waitForExistence(timeout: 5))
    }

    func testTagsCanBeEditedAndPersisted() {
        let app = launchAndIngestExample()
        let webView = app.webViews["prototype-webview"]

        let editButton = webView.buttons["编辑 Tag"]
        XCTAssertTrue(editButton.waitForExistence(timeout: 5))
        editButton.tap()

        let addProductTag = webView.buttons["添加 Tag 产品"]
        XCTAssertTrue(addProductTag.waitForExistence(timeout: 5))
        addProductTag.tap()
        webView.buttons["保存修改"].tap()

        XCTAssertTrue(webView.staticTexts["产品"].waitForExistence(timeout: 5))
    }

    func testGroundedAIAnswerUsesSavedContent() {
        let app = launchAndIngestExample()
        let webView = app.webViews["prototype-webview"]

        let askButton = webView.buttons["基于这篇问 AI"]
        XCTAssertTrue(askButton.waitForExistence(timeout: 5))
        askButton.tap()

        XCTAssertTrue(webView.staticTexts["Memo AI"].waitForExistence(timeout: 5))
        let groundedAnswer = webView.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "只整理了你已收藏的原文")
        ).firstMatch
        XCTAssertTrue(groundedAnswer.waitForExistence(timeout: 20))
    }

    func testSettingsExposePrivacyAndLocalReset() {
        let app = launchApp(reset: true, skipOnboarding: true)
        let webView = app.webViews["prototype-webview"]
        XCTAssertTrue(webView.waitForExistence(timeout: 8))

        let settingsButton = webView.buttons["设置"]
        XCTAssertTrue(settingsButton.waitForExistence(timeout: 5))
        settingsButton.tap()

        XCTAssertTrue(app.sheets["Memo 设置"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["隐私说明"].exists)
        XCTAssertTrue(app.buttons["清空本机全部数据"].exists)
    }

    private func launchAndIngestExample() -> XCUIApplication {
        let app = launchApp(
            screenID: "03-add",
            reset: true,
            skipOnboarding: true
        )
        let webView = app.webViews["prototype-webview"]
        XCTAssertTrue(webView.waitForExistence(timeout: 8))

        let urlField = webView.textViews["内容链接"]
        XCTAssertTrue(urlField.waitForExistence(timeout: 5))
        urlField.tap()
        urlField.typeText(exampleURL)
        dismissKeyboard(in: app)
        webView.buttons["收藏到 Memo"].tap()

        XCTAssertTrue(
            webView.staticTexts["Example Domain"].waitForExistence(timeout: 30)
        )
        return app
    }

    private func dismissKeyboard(in app: XCUIApplication) {
        let doneButton = app.toolbars.buttons["Done"]
        if doneButton.waitForExistence(timeout: 2) {
            doneButton.tap()
        }
    }

    private func launchApp(
        screenID: String = "01-home",
        reset: Bool,
        skipOnboarding: Bool
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KNOWLEDGE_SCREEN"] = screenID
        app.launchEnvironment["KNOWLEDGE_RESET_ON_LAUNCH"] = reset ? "1" : "0"
        app.launchEnvironment["KNOWLEDGE_SKIP_ONBOARDING"] =
            skipOnboarding ? "1" : "0"
        app.launch()
        return app
    }
}
