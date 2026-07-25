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

        let memoTitle = webView.staticTexts["Memo AI"]
        XCTAssertTrue(memoTitle.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(memoTitle.frame.minY, webView.frame.minY + 44)
        let groundedAnswer = webView.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "只整理了你已收藏的原文")
        ).firstMatch
        XCTAssertTrue(groundedAnswer.waitForExistence(timeout: 20))

        let frameBeforeDoubleTap = groundedAnswer.frame
        groundedAnswer.doubleTap()
        let frameAfterDoubleTap = groundedAnswer.frame
        XCTAssertEqual(frameAfterDoubleTap.midX, frameBeforeDoubleTap.midX, accuracy: 1)
        XCTAssertEqual(frameAfterDoubleTap.midY, frameBeforeDoubleTap.midY, accuracy: 1)
        XCTAssertEqual(frameAfterDoubleTap.width, frameBeforeDoubleTap.width, accuracy: 1)
        XCTAssertEqual(frameAfterDoubleTap.height, frameBeforeDoubleTap.height, accuracy: 1)

        let questionField = webView.textFields["向 Memo AI 提问"]
        XCTAssertTrue(questionField.waitForExistence(timeout: 3))
        questionField.tap()
        questionField.typeText("More")
        webView.buttons["发送问题"].tap()
        XCTAssertTrue(app.toolbars.buttons["Done"].waitForNonExistence(timeout: 3))
    }

    func testRegistrationLogoutAndLoginFlow() {
        let authMode = ProcessInfo.processInfo.environment["KNOWLEDGE_AUTH_TEST_MODE"] ?? "mock"
        let emailAddress = authMode == "live"
            ? "memo.ui.\(UUID().uuidString.lowercased())@example.com"
            : "memo.tester@example.com"
        let app = launchApp(
            reset: true,
            skipOnboarding: false,
            authMode: authMode,
            resetAuth: true
        )
        let webView = app.webViews["prototype-webview"]
        XCTAssertTrue(webView.waitForExistence(timeout: 8))
        XCTAssertTrue(webView.buttons["下一步"].waitForExistence(timeout: 5))
        XCTAssertFalse(webView.buttons["登录"].exists)
        completeOnboarding(in: webView)
        XCTAssertTrue(webView.buttons["登录"].waitForExistence(timeout: 5))

        webView.buttons["立即注册"].tap()
        let nickname = webView.textFields["昵称"]
        let email = webView.textFields["注册手机号或者邮箱"]
        XCTAssertTrue(nickname.waitForExistence(timeout: 3))
        nickname.tap()
        nickname.typeText("Memo Tester")
        email.tap()
        email.typeText(emailAddress)
        let registerNext = app.keyboards.buttons["next"]
        XCTAssertTrue(registerNext.waitForExistence(timeout: 3))
        registerNext.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        app.typeText("Password123")
        let registerDone = app.keyboards.buttons["done"]
        XCTAssertTrue(registerDone.waitForExistence(timeout: 3))
        registerDone.tap()

        XCTAssertTrue(webView.buttons["添加第 1 条"].waitForExistence(timeout: 5))
        webView.buttons["设置"].tap()
        XCTAssertTrue(app.sheets["Memo 设置"].waitForExistence(timeout: 5))
        app.buttons["退出登录"].tap()

        XCTAssertTrue(webView.buttons["登录"].waitForExistence(timeout: 5))
        let loginEmail = webView.textFields["登录手机号或者邮箱"]
        let loginPassword = webView.secureTextFields["登录密码"]
        loginEmail.tap()
        loginEmail.typeText(emailAddress)
        let loginNext = app.keyboards.buttons["next"]
        XCTAssertTrue(loginNext.waitForExistence(timeout: 3))
        loginNext.tap()
        XCTAssertTrue(loginPassword.exists)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        app.typeText("Password123")
        let loginDone = app.keyboards.buttons["done"]
        XCTAssertTrue(loginDone.waitForExistence(timeout: 3))
        loginDone.tap()
        XCTAssertTrue(webView.buttons["添加第 1 条"].waitForExistence(timeout: 5))
    }

    func testPhoneRegistrationLogoutAndLoginFlow() {
        let authMode = ProcessInfo.processInfo.environment["KNOWLEDGE_AUTH_TEST_MODE"] ?? "mock"
        let phoneNumber = authMode == "live"
            ? "139\(String(format: "%08d", Int.random(in: 0...99_999_999)))"
            : "13800138000"
        let app = launchApp(
            reset: true,
            skipOnboarding: false,
            authMode: authMode,
            resetAuth: true
        )
        let webView = app.webViews["prototype-webview"]
        XCTAssertTrue(webView.waitForExistence(timeout: 8))
        completeOnboarding(in: webView)
        XCTAssertTrue(webView.buttons["登录"].waitForExistence(timeout: 5))

        webView.buttons["立即注册"].tap()
        let nickname = webView.textFields["昵称"]
        let phone = webView.textFields["注册手机号或者邮箱"]
        nickname.tap()
        nickname.typeText("手机用户")
        phone.tap()
        phone.typeText(phoneNumber)
        let registerNext = app.keyboards.buttons["next"]
        XCTAssertTrue(registerNext.waitForExistence(timeout: 3))
        registerNext.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        app.typeText("Password123")
        XCTAssertTrue(app.keyboards.buttons["done"].waitForExistence(timeout: 3))
        app.keyboards.buttons["done"].tap()

        XCTAssertTrue(webView.buttons["添加第 1 条"].waitForExistence(timeout: 5))
        webView.buttons["设置"].tap()
        XCTAssertTrue(app.sheets["Memo 设置"].waitForExistence(timeout: 5))
        app.buttons["退出登录"].tap()

        XCTAssertTrue(webView.buttons["登录"].waitForExistence(timeout: 5))
        let loginPhone = webView.textFields["登录手机号或者邮箱"]
        loginPhone.tap()
        loginPhone.typeText(phoneNumber)
        let loginNext = app.keyboards.buttons["next"]
        XCTAssertTrue(loginNext.waitForExistence(timeout: 3))
        loginNext.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        app.typeText("Password123")
        XCTAssertTrue(app.keyboards.buttons["done"].waitForExistence(timeout: 3))
        app.keyboards.buttons["done"].tap()
        XCTAssertTrue(webView.buttons["添加第 1 条"].waitForExistence(timeout: 5))
    }

    func testUnauthenticatedUserCannotOpenFeatureRoute() {
        let app = launchApp(
            screenID: "03-add",
            reset: true,
            skipOnboarding: true,
            authMode: "mock",
            resetAuth: true
        )
        let webView = app.webViews["prototype-webview"]
        XCTAssertTrue(webView.waitForExistence(timeout: 8))
        XCTAssertTrue(webView.buttons["登录"].waitForExistence(timeout: 5))
        XCTAssertFalse(webView.buttons["收藏到 Memo"].exists)
        XCTAssertFalse(webView.buttons["搜索"].exists)
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

    private func completeOnboarding(in webView: XCUIElement) {
        let nextButton = webView.buttons["下一步"]
        XCTAssertTrue(nextButton.waitForExistence(timeout: 5))
        nextButton.tap()
        webView.buttons["下一步"].tap()
        let startButton = webView.buttons["开始使用"]
        XCTAssertTrue(startButton.waitForExistence(timeout: 3))
        startButton.tap()
    }

    private func launchApp(
        screenID: String = "01-home",
        reset: Bool,
        skipOnboarding: Bool,
        authMode: String = "bypass",
        resetAuth: Bool = false
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KNOWLEDGE_SCREEN"] = screenID
        app.launchEnvironment["KNOWLEDGE_RESET_ON_LAUNCH"] = reset ? "1" : "0"
        app.launchEnvironment["KNOWLEDGE_SKIP_ONBOARDING"] =
            skipOnboarding ? "1" : "0"
        app.launchEnvironment["KNOWLEDGE_AUTH_MODE"] = authMode
        app.launchEnvironment["KNOWLEDGE_RESET_AUTH_ON_LAUNCH"] =
            resetAuth ? "1" : "0"
        app.launch()
        return app
    }
}
