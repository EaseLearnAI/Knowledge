import XCTest

@MainActor
final class KnowledgeIOSUITests: XCTestCase {
    private let exampleURL = "https://www.bilibili.com/video/BV1GWNQ6jE2x/"
    private let exampleTitle = "AI 工具复刻官方宣传片"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testEntireAppUsesNativeUIKitWithoutWebView() {
        let app = launchApp(reset: true, skipOnboarding: true)
        XCTAssertTrue(app.buttons["侧边栏"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["搜索"].exists)
        XCTAssertTrue(app.buttons["添加第 1 条"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
        assertNativeHeader(in: app)
    }

    func testFirstLaunchCompletesNativeOnboarding() {
        let app = launchApp(reset: true, skipOnboarding: false)
        XCTAssertTrue(app.buttons["下一步"].waitForExistence(timeout: 8))
        XCTAssertTrue(
            app.staticTexts.containing(
                NSPredicate(format: "label CONTAINS %@", "以后再学")
            ).firstMatch.exists
        )
        app.buttons["下一步"].tap()
        XCTAssertTrue(app.buttons["开始使用"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.staticTexts.containing(
                NSPredicate(format: "label CONTAINS %@", "每一次收藏")
            ).firstMatch.exists
        )
        app.buttons["开始使用"].tap()
        XCTAssertTrue(app.buttons["添加第 1 条"].waitForExistence(timeout: 5))
        assertNativeHeader(in: app)
    }

    func testProductIntroUsesOneClearPrimaryAction() {
        let app = launchApp(
            reset: true,
            skipOnboarding: true,
            authMode: "mock",
            resetAuth: true
        )
        XCTAssertTrue(app.staticTexts["把想学的"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["开始使用"].exists)
        XCTAssertFalse(app.buttons["创建账号"].exists)
        XCTAssertFalse(app.buttons["登录"].exists)

        app.buttons["开始使用"].tap()
        XCTAssertTrue(app.buttons["提交登录"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["切换到创建账号"].exists)
    }

    func testNativeAddProcessesURLAndPersistsAcrossRelaunch() {
        var app = launchApp(
            screenID: "03-add",
            reset: true,
            skipOnboarding: true
        )
        addExampleURL(in: app)
        XCTAssertTrue(
            app.staticTexts[exampleTitle].waitForExistence(timeout: 30)
        )
        XCTAssertFalse(app.webViews.firstMatch.exists)

        app.terminate()
        app = launchApp(reset: false, skipOnboarding: true)
        XCTAssertTrue(
            app.cells[exampleTitle].waitForExistence(timeout: 8)
        )
    }

    func testNativeAddExtractsVideoURLFromShareText() {
        let app = launchApp(
            screenID: "03-add",
            reset: true,
            skipOnboarding: true
        )
        let field = app.textViews["内容链接"]
        XCTAssertTrue(field.waitForExistence(timeout: 8))
        let initialSheetTop = app.navigationBars["添加收藏"].frame.minY
        field.tap()
        field.typeText(
            "【地狱梗刷屏、学术打假、CEO发疯——2026上半年，社会在反抗什么？】 " +
                "https://www.bilibili.com/video/BV1GWNQ6jE2x/?" +
                "share_source=copy_web&vd_source=f6059df809e9959aa18ac40468f06d58"
        )
        app.staticTexts["粘贴分享文案或链接"].tap()
        XCTAssertEqual(
            app.navigationBars["添加收藏"].frame.minY,
            initialSheetTop,
            accuracy: 1
        )
        XCTAssertFalse(app.toolbars.buttons["完成"].exists)
        XCTAssertEqual(app.buttons.matching(identifier: "收藏").count, 1)
        app.buttons["收藏"].tap()

        XCTAssertTrue(app.navigationBars["Memo"].waitForExistence(timeout: 5))
        let analyzing = app.cells["分析中卡片"]
        XCTAssertTrue(analyzing.waitForExistence(timeout: 3))
        XCTAssertTrue(analyzing.label.contains("已用时"))
        XCTAssertTrue(analyzing.label.contains("流程 48%"))
        XCTAssertFalse(app.navigationBars["处理中"].exists)
        XCTAssertFalse(app.alerts["无法收藏"].exists)
    }

    func testNativeSearchOpensSavedResult() {
        let app = launchAndIngestExample()
        app.navigationBars.buttons["Memo"].tapIfExists()
        let search = app.buttons["搜索"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()

        let field = app.searchFields["搜索收藏"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("AI 工具")
        let result = app.cells[exampleTitle]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        XCTAssertTrue(app.staticTexts[exampleTitle].waitForExistence(timeout: 5))
    }

    func testNativeDetailAndTagsPersist() {
        let app = launchAndIngestExample()
        XCTAssertTrue(app.staticTexts["一句话摘要"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["基于这篇问 AI"].exists)

        app.buttons["编辑 Tag"].tap()
        let product = app.buttons["添加 Tag 产品"]
        XCTAssertTrue(product.waitForExistence(timeout: 5))
        product.tap()
        XCTAssertTrue(
            app.buttons["移除 Tag 产品"].waitForExistence(timeout: 3)
        )
        app.buttons["保存修改"].tap()
        XCTAssertTrue(
            app.staticTexts["标签 产品"].waitForExistence(timeout: 5)
        )
    }

    func testNativeSidebarAndSettingsOnlyExposeMinimumActions() {
        let app = launchApp(reset: true, skipOnboarding: true)
        openSettings(in: app)
        XCTAssertTrue(app.navigationBars["设置"].exists)
        XCTAssertTrue(app.buttons["修改密码"].exists)
        XCTAssertTrue(app.buttons["删除账号"].exists)
        XCTAssertTrue(app.buttons["退出登录"].exists)
        XCTAssertTrue(app.buttons["隐私政策"].exists)
        XCTAssertFalse(app.buttons["偏好设置"].exists)
        XCTAssertFalse(app.buttons["AI 设置"].exists)
        XCTAssertFalse(app.buttons["会员权益"].exists)

        app.buttons["隐私政策"].tap()
        XCTAssertTrue(
            app.otherElements["隐私政策浏览器"].waitForExistence(timeout: 5)
        )
    }

    func testNativePasswordValidationAndDeleteAccount() {
        let app = launchApp(reset: true, skipOnboarding: true)
        openSettings(in: app)
        app.buttons["修改密码"].tap()

        app.secureTextFields["新密码"].tap()
        app.secureTextFields["新密码"].typeText("NewPassword123")
        app.secureTextFields["确认新密码"].tap()
        app.secureTextFields["确认新密码"].typeText("Different123")
        app.buttons["保存新密码"].tap()
        XCTAssertTrue(app.alerts["无法修改密码"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["两次输入的新密码不一致"].exists)
        app.buttons["知道了"].tap()

        app.navigationBars.buttons["设置"].tap()
        app.buttons["删除账号"].tap()
        XCTAssertTrue(app.alerts["删除账号？"].waitForExistence(timeout: 3))
        app.secureTextFields["删除账号当前密码"].tap()
        app.secureTextFields["删除账号当前密码"].typeText("Password123")
        app.buttons["永久删除"].tap()
        XCTAssertTrue(app.buttons["开始使用"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["创建账号"].exists)
        XCTAssertFalse(app.buttons["登录"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }

    func testNativeRegistrationLogoutAndLoginFlow() {
        var app = launchApp(
            reset: true,
            skipOnboarding: true,
            authMode: "mock",
            resetAuth: true
        )
        XCTAssertTrue(app.buttons["开始使用"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["创建账号"].exists)
        XCTAssertFalse(app.buttons["登录"].exists)
        app.buttons["开始使用"].tap()
        XCTAssertTrue(
            app.buttons["切换到创建账号"].waitForExistence(timeout: 5)
        )
        app.buttons["切换到创建账号"].tap()

        app.textFields["昵称"].tap()
        app.textFields["昵称"].typeText("Memo Tester")
        app.textFields["注册手机号或者邮箱"].tap()
        app.textFields["注册手机号或者邮箱"].typeText("memo.tester@example.com")
        app.secureTextFields["注册密码"].tap()
        app.typeText("Password123")
        XCTAssertTrue(app.toolbars.buttons["完成"].waitForExistence(timeout: 3))
        app.toolbars.buttons["完成"].tap()
        app.buttons["提交创建账号"].tap()
        XCTAssertTrue(app.buttons["添加第 1 条"].waitForExistence(timeout: 5))

        app.terminate()
        app = launchApp(
            reset: false,
            skipOnboarding: true,
            authMode: "mock"
        )
        openSettings(in: app)
        app.buttons["退出登录"].tap()
        XCTAssertTrue(app.alerts["退出登录？"].waitForExistence(timeout: 3))
        app.buttons["确认退出"].tap()

        XCTAssertTrue(app.buttons["开始使用"].waitForExistence(timeout: 5))
        app.buttons["开始使用"].tap()
        app.textFields["登录手机号或者邮箱"].tap()
        app.textFields["登录手机号或者邮箱"].typeText("memo.tester@example.com")
        app.secureTextFields["登录密码"].tap()
        app.typeText("Password123")
        XCTAssertTrue(app.toolbars.buttons["完成"].waitForExistence(timeout: 3))
        app.toolbars.buttons["完成"].tap()
        app.buttons["提交登录"].tap()
        XCTAssertTrue(app.buttons["添加第 1 条"].waitForExistence(timeout: 5))
    }

    func testLocalLibraryIsIsolatedByAccountAndRestored() {
        var app = launchApp(
            screenID: "03-add",
            reset: true,
            skipOnboarding: true,
            bypassIdentifier: "native-owner-a@memo.local"
        )
        addExampleURL(in: app)
        XCTAssertTrue(
            app.staticTexts[exampleTitle].waitForExistence(timeout: 30)
        )

        app.terminate()
        app = launchApp(
            reset: false,
            skipOnboarding: true,
            bypassIdentifier: "native-owner-b@memo.local"
        )
        XCTAssertTrue(app.buttons["添加第 1 条"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.cells[exampleTitle].exists)

        app.terminate()
        app = launchApp(
            reset: false,
            skipOnboarding: true,
            bypassIdentifier: "native-owner-a@memo.local"
        )
        XCTAssertTrue(app.cells[exampleTitle].waitForExistence(timeout: 8))
    }

    func testNativeNavigationSupportsAccessibilityTextSize() {
        let app = launchApp(
            reset: true,
            skipOnboarding: true,
            accessibilityTextSize: true
        )
        assertNativeHeader(in: app)
        app.buttons["侧边栏"].tap()
        XCTAssertTrue(app.buttons["设置"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["UI 测试"].exists)
    }

    private func launchAndIngestExample() -> XCUIApplication {
        let app = launchApp(
            screenID: "03-add",
            reset: true,
            skipOnboarding: true
        )
        addExampleURL(in: app)
        XCTAssertTrue(
            app.staticTexts[exampleTitle].waitForExistence(timeout: 30)
        )
        let item = app.cells[exampleTitle]
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        item.tap()
        XCTAssertTrue(app.staticTexts["一句话摘要"].waitForExistence(timeout: 5))
        return app
    }

    private func addExampleURL(in app: XCUIApplication) {
        let field = app.textViews["内容链接"]
        XCTAssertTrue(field.waitForExistence(timeout: 8))
        field.tap()
        field.typeText(exampleURL)
        let collect = app.buttons["收藏"]
        XCTAssertTrue(collect.waitForExistence(timeout: 3))
        collect.tap()
    }

    private func completeOnboarding(in app: XCUIApplication) {
        let next = app.buttons["下一步"]
        XCTAssertTrue(next.waitForExistence(timeout: 5))
        next.coordinate(
            withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
        ).tap()
        XCTAssertTrue(app.buttons["开始使用"].waitForExistence(timeout: 5))
        app.buttons["开始使用"].tap()
    }

    private func assertNativeHeader(in app: XCUIApplication) {
        let sidebar = app.buttons["侧边栏"]
        let search = app.buttons["搜索"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 8))
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(sidebar.frame.width, 44)
        XCTAssertGreaterThanOrEqual(sidebar.frame.height, 44)
        XCTAssertGreaterThanOrEqual(search.frame.width, 44)
        XCTAssertGreaterThanOrEqual(search.frame.height, 44)
        XCTAssertTrue(sidebar.isHittable)
        XCTAssertTrue(search.isHittable)
    }

    private func openSettings(in app: XCUIApplication) {
        assertNativeHeader(in: app)
        app.buttons["侧边栏"].tap()
        let settings = app.buttons["设置"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["每日回顾"].exists)
        XCTAssertFalse(app.buttons["AI 洞察"].exists)
        settings.tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 5))
    }

    private func launchApp(
        screenID: String = "01-home",
        reset: Bool,
        skipOnboarding: Bool,
        authMode: String = "bypass",
        resetAuth: Bool = false,
        bypassIdentifier: String = "ui-tests@memo.local",
        accessibilityTextSize: Bool = false
    ) -> XCUIApplication {
        let app = XCUIApplication()
        if accessibilityTextSize {
            app.launchArguments += [
                "-UIPreferredContentSizeCategoryName",
                "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
            ]
        }
        app.launchEnvironment["KNOWLEDGE_SCREEN"] = screenID
        app.launchEnvironment["KNOWLEDGE_RESET_ON_LAUNCH"] = reset ? "1" : "0"
        app.launchEnvironment["KNOWLEDGE_SKIP_ONBOARDING"] =
            skipOnboarding ? "1" : "0"
        app.launchEnvironment["KNOWLEDGE_AUTH_MODE"] = authMode
        app.launchEnvironment["KNOWLEDGE_BYPASS_IDENTIFIER"] = bypassIdentifier
        app.launchEnvironment["KNOWLEDGE_RESET_AUTH_ON_LAUNCH"] =
            resetAuth ? "1" : "0"
        app.launchEnvironment["KNOWLEDGE_UI_TEST_FIXTURE"] = "1"
        app.launch()
        return app
    }
}

private extension XCUIElement {
    func tapIfExists() {
        if exists { tap() }
    }

}
