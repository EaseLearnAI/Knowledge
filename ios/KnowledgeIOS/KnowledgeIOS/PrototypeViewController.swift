import SafariServices
import UIKit
import WebKit

private final class MemoWebView: WKWebView {
    override var inputAccessoryView: UIView? { nil }
}

@MainActor
private final class MemoSettingsViewController: UIViewController {
    typealias ChangePasswordHandler = (String, String) async throws -> Void
    typealias DeleteAccountHandler = (String) async throws -> Void
    typealias LogoutHandler = () async -> Void

    private let user: AuthUser
    private let onChangePassword: ChangePasswordHandler
    private let onDeleteAccount: DeleteAccountHandler
    private let onLogout: LogoutHandler
    private var actionButtons: [UIButton] = []

    init(
        user: AuthUser,
        onChangePassword: @escaping ChangePasswordHandler,
        onDeleteAccount: @escaping DeleteAccountHandler,
        onLogout: @escaping LogoutHandler
    ) {
        self.user = user
        self.onChangePassword = onChangePassword
        self.onDeleteAccount = onDeleteAccount
        self.onLogout = onLogout
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "设置"
        view.backgroundColor = .systemGroupedBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            systemItem: .close,
            primaryAction: UIAction { [weak self] _ in
                self?.dismiss(animated: true)
            }
        )
        configureContent()
    }

    private func configureContent() {
        let scrollView = UIScrollView()
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        view.addSubview(scrollView)

        let content = UIStackView()
        content.axis = .vertical
        content.spacing = 16
        content.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(content)

        let accountCard = makeAccountCard()
        let changePassword = makeActionButton(
            title: "修改密码",
            symbol: "key",
            color: .label,
            action: #selector(changePasswordTapped)
        )
        let deleteAccount = makeActionButton(
            title: "删除账号",
            symbol: "person.crop.circle.badge.minus",
            color: .systemRed,
            action: #selector(deleteAccountTapped)
        )
        let logout = makeActionButton(
            title: "退出登录",
            symbol: "rectangle.portrait.and.arrow.right",
            color: .systemRed,
            action: #selector(logoutTapped)
        )

        let privacy = UIButton(type: .system)
        var privacyConfiguration = UIButton.Configuration.plain()
        privacyConfiguration.title = "隐私政策"
        privacyConfiguration.baseForegroundColor = .secondaryLabel
        privacyConfiguration.contentInsets = NSDirectionalEdgeInsets(
            top: 12,
            leading: 16,
            bottom: 12,
            trailing: 16
        )
        privacy.configuration = privacyConfiguration
        privacy.accessibilityIdentifier = "隐私政策"
        privacy.addTarget(
            self,
            action: #selector(privacyTapped),
            for: .touchUpInside
        )

        [accountCard, changePassword, deleteAccount, logout, privacy].forEach {
            content.addArrangedSubview($0)
        }
        content.setCustomSpacing(28, after: changePassword)
        content.setCustomSpacing(28, after: deleteAccount)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            content.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 20),
            content.leadingAnchor.constraint(
                equalTo: scrollView.frameLayoutGuide.leadingAnchor,
                constant: 20
            ),
            content.trailingAnchor.constraint(
                equalTo: scrollView.frameLayoutGuide.trailingAnchor,
                constant: -20
            ),
            content.bottomAnchor.constraint(
                lessThanOrEqualTo: scrollView.contentLayoutGuide.bottomAnchor,
                constant: -24
            ),

            changePassword.heightAnchor.constraint(greaterThanOrEqualToConstant: 56),
            deleteAccount.heightAnchor.constraint(greaterThanOrEqualToConstant: 56),
            logout.heightAnchor.constraint(greaterThanOrEqualToConstant: 56),
        ])
    }

    private func makeAccountCard() -> UIView {
        let card = UIView()
        card.backgroundColor = .secondarySystemGroupedBackground
        card.layer.cornerRadius = 18
        card.translatesAutoresizingMaskIntoConstraints = false

        let name = UILabel()
        name.text = user.nickname
        name.font = .preferredFont(forTextStyle: .title2)
        name.adjustsFontForContentSizeCategory = true
        name.textColor = .label

        let identifier = UILabel()
        identifier.text = maskedIdentifier(user.primaryIdentifier)
        identifier.font = .preferredFont(forTextStyle: .subheadline)
        identifier.adjustsFontForContentSizeCategory = true
        identifier.textColor = .secondaryLabel

        let stack = UIStackView(arrangedSubviews: [name, identifier])
        stack.axis = .vertical
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
        ])
        card.accessibilityIdentifier = "账号信息"
        return card
    }

    private func makeActionButton(
        title: String,
        symbol: String,
        color: UIColor,
        action: Selector
    ) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.filled()
        configuration.title = title
        configuration.image = UIImage(systemName: symbol)
        configuration.imagePadding = 12
        configuration.baseForegroundColor = color
        configuration.baseBackgroundColor = .secondarySystemGroupedBackground
        configuration.cornerStyle = .large
        configuration.contentInsets = NSDirectionalEdgeInsets(
            top: 16,
            leading: 18,
            bottom: 16,
            trailing: 18
        )
        button.configuration = configuration
        button.contentHorizontalAlignment = .leading
        button.accessibilityIdentifier = title
        button.addTarget(self, action: action, for: .touchUpInside)
        actionButtons.append(button)
        return button
    }

    @objc private func changePasswordTapped() {
        let controller = ChangePasswordViewController(
            onSubmit: onChangePassword
        )
        navigationController?.pushViewController(controller, animated: true)
    }

    @objc private func deleteAccountTapped() {
        let alert = UIAlertController(
            title: "删除账号？",
            message: "账号、云端内容和本机资料都会永久删除，无法恢复。请输入当前密码确认。",
            preferredStyle: .alert
        )
        alert.addTextField { field in
            field.placeholder = "当前密码"
            field.isSecureTextEntry = true
            field.textContentType = .password
            field.accessibilityLabel = "删除账号当前密码"
        }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(
            UIAlertAction(title: "永久删除", style: .destructive) { [weak self, weak alert] _ in
                guard let self else { return }
                let password = alert?.textFields?.first?.text ?? ""
                self.performDelete(password: password)
            }
        )
        present(alert, animated: true)
    }

    @objc private func logoutTapped() {
        let alert = UIAlertController(
            title: "退出登录？",
            message: "本机资料会保留，并在你使用同一账号登录后恢复。",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(
            UIAlertAction(title: "确认退出", style: .destructive) { [weak self] _ in
                self?.performLogout()
            }
        )
        present(alert, animated: true)
    }

    @objc private func privacyTapped() {
        guard let url = URL(
            string: "https://memo-privacy-support.dreamyyds.chatgpt.site"
        ) else { return }
        let browser = SFSafariViewController(url: url)
        browser.view.accessibilityIdentifier = "隐私政策浏览器"
        present(browser, animated: true)
    }

    private func performDelete(password: String) {
        setBusy(true)
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await onDeleteAccount(password)
            } catch {
                setBusy(false)
                presentError(error)
            }
        }
    }

    private func performLogout() {
        setBusy(true)
        Task { @MainActor [weak self] in
            guard let self else { return }
            await onLogout()
        }
    }

    private func setBusy(_ busy: Bool) {
        actionButtons.forEach { $0.isEnabled = !busy }
        if busy {
            let spinner = UIActivityIndicatorView(style: .medium)
            spinner.startAnimating()
            navigationItem.rightBarButtonItem = UIBarButtonItem(customView: spinner)
        } else {
            navigationItem.rightBarButtonItem = nil
        }
    }

    private func presentError(_ error: Error) {
        let alert = UIAlertController(
            title: "操作失败",
            message: error.localizedDescription,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }

    private func maskedIdentifier(_ identifier: String) -> String {
        if let at = identifier.firstIndex(of: "@") {
            let name = identifier[..<at]
            let domain = identifier[identifier.index(after: at)...]
            return "\(name.prefix(2))***@\(domain)"
        }
        let digits = identifier.filter(\.isNumber)
        guard digits.count > 7 else { return identifier }
        return "\(digits.prefix(3)) **** \(digits.suffix(4))"
    }
}

@MainActor
private final class ChangePasswordViewController: UIViewController {
    typealias SubmitHandler = (String, String) async throws -> Void

    private let onSubmit: SubmitHandler
    private let currentPassword = UITextField()
    private let newPassword = UITextField()
    private let confirmPassword = UITextField()
    private let saveButton = UIButton(type: .system)

    init(onSubmit: @escaping SubmitHandler) {
        self.onSubmit = onSubmit
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "修改密码"
        view.backgroundColor = .systemGroupedBackground
        configureFields()
        configureLayout()
    }

    private func configureFields() {
        configure(
            currentPassword,
            placeholder: "当前密码",
            contentType: .password,
            accessibilityLabel: "当前密码"
        )
        configure(
            newPassword,
            placeholder: "新密码",
            contentType: .newPassword,
            accessibilityLabel: "新密码"
        )
        configure(
            confirmPassword,
            placeholder: "再次输入新密码",
            contentType: .newPassword,
            accessibilityLabel: "确认新密码"
        )
        currentPassword.returnKeyType = .next
        newPassword.returnKeyType = .next
        confirmPassword.returnKeyType = .done

        currentPassword.addTarget(
            newPassword,
            action: #selector(UIResponder.becomeFirstResponder),
            for: .editingDidEndOnExit
        )
        newPassword.addTarget(
            confirmPassword,
            action: #selector(UIResponder.becomeFirstResponder),
            for: .editingDidEndOnExit
        )
        confirmPassword.addTarget(
            self,
            action: #selector(submit),
            for: .editingDidEndOnExit
        )

        var configuration = UIButton.Configuration.filled()
        configuration.title = "保存新密码"
        configuration.baseBackgroundColor = .label
        configuration.baseForegroundColor = .systemBackground
        configuration.cornerStyle = .large
        saveButton.configuration = configuration
        saveButton.accessibilityIdentifier = "保存新密码"
        saveButton.addTarget(self, action: #selector(submit), for: .touchUpInside)
    }

    private func configure(
        _ field: UITextField,
        placeholder: String,
        contentType: UITextContentType,
        accessibilityLabel: String
    ) {
        field.placeholder = placeholder
        field.isSecureTextEntry = true
        field.textContentType = contentType
        field.borderStyle = .roundedRect
        field.font = .preferredFont(forTextStyle: .body)
        field.adjustsFontForContentSizeCategory = true
        field.accessibilityLabel = accessibilityLabel
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
    }

    private func configureLayout() {
        let hint = UILabel()
        hint.text = "至少 8 位，并同时包含字母和数字。"
        hint.font = .preferredFont(forTextStyle: .footnote)
        hint.adjustsFontForContentSizeCategory = true
        hint.textColor = .secondaryLabel
        hint.numberOfLines = 0

        let stack = UIStackView(
            arrangedSubviews: [
                currentPassword,
                newPassword,
                confirmPassword,
                hint,
                saveButton,
            ]
        )
        stack.axis = .vertical
        stack.spacing = 14
        stack.setCustomSpacing(8, after: confirmPassword)
        stack.setCustomSpacing(24, after: hint)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.topAnchor,
                constant: 24
            ),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            currentPassword.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),
            newPassword.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),
            confirmPassword.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),
            saveButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 52),
        ])
    }

    @objc private func submit() {
        view.endEditing(true)
        let current = currentPassword.text ?? ""
        let new = newPassword.text ?? ""
        let confirmation = confirmPassword.text ?? ""
        guard new == confirmation else {
            presentError(message: "两次输入的新密码不一致")
            return
        }

        saveButton.isEnabled = false
        saveButton.configuration?.showsActivityIndicator = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await onSubmit(current, new)
                let alert = UIAlertController(
                    title: "密码已更新",
                    message: "其他设备上的登录状态将在访问令牌到期后失效。",
                    preferredStyle: .alert
                )
                alert.addAction(
                    UIAlertAction(title: "完成", style: .default) { [weak self] _ in
                        self?.navigationController?.popViewController(animated: true)
                    }
                )
                present(alert, animated: true)
            } catch {
                saveButton.isEnabled = true
                saveButton.configuration?.showsActivityIndicator = false
                presentError(message: error.localizedDescription)
            }
        }
    }

    private func presentError(message: String) {
        let alert = UIAlertController(
            title: "无法修改密码",
            message: message,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }
}

private final class MemoNativeHeaderView: UIView {
    let menuButton = UIButton(type: .system)
    let searchButton = UIButton(type: .system)

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .systemBackground
        accessibilityIdentifier = "memo-native-header"

        let titleLabel = UILabel()
        titleLabel.text = "Memo"
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.textColor = .label
        titleLabel.textAlignment = .center
        titleLabel.adjustsFontForContentSizeCategory = true

        configure(
            menuButton,
            symbol: "line.3.horizontal",
            accessibilityLabel: "侧边栏"
        )
        configure(
            searchButton,
            symbol: "magnifyingglass",
            accessibilityLabel: "搜索"
        )

        [menuButton, titleLabel, searchButton].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }
        NSLayoutConstraint.activate([
            menuButton.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            menuButton.centerYAnchor.constraint(equalTo: centerYAnchor),
            menuButton.widthAnchor.constraint(equalToConstant: 44),
            menuButton.heightAnchor.constraint(equalToConstant: 44),

            searchButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            searchButton.centerYAnchor.constraint(equalTo: centerYAnchor),
            searchButton.widthAnchor.constraint(equalToConstant: 44),
            searchButton.heightAnchor.constraint(equalToConstant: 44),

            titleLabel.centerXAnchor.constraint(equalTo: centerXAnchor),
            titleLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
            titleLabel.leadingAnchor.constraint(
                greaterThanOrEqualTo: menuButton.trailingAnchor,
                constant: 12
            ),
            titleLabel.trailingAnchor.constraint(
                lessThanOrEqualTo: searchButton.leadingAnchor,
                constant: -12
            ),
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func configure(
        _ button: UIButton,
        symbol: String,
        accessibilityLabel: String
    ) {
        var configuration = UIButton.Configuration.plain()
        configuration.image = UIImage(
            systemName: symbol,
            withConfiguration: UIImage.SymbolConfiguration(
                pointSize: 18,
                weight: .semibold
            )
        )
        configuration.baseForegroundColor = .label
        configuration.background.backgroundColor = .secondarySystemBackground
        configuration.background.cornerRadius = 22
        button.configuration = configuration
        button.accessibilityLabel = accessibilityLabel
        button.accessibilityIdentifier = accessibilityLabel
        button.accessibilityHint = accessibilityLabel == "搜索"
            ? "打开收藏搜索"
            : "打开账号侧边栏"
    }
}

final class PrototypeViewController: UIViewController, WKNavigationDelegate {
    private static let validScreenIDs: Set<String> = [
        "01-home",
        "02-home-empty",
        "03-add",
        "04-detail-podcast",
        "06-detail-article",
        "07-processing",
        "08-search",
        "09-onboarding",
        "10-unsupported",
        "11-edit-tags",
        "15-auth-intro",
        "13-auth-login",
        "14-auth-register",
    ]

    private lazy var webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: Self.prototypeBootstrapScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )
        if let runtimeScript = Self.runtimeScript {
            configuration.userContentController.addUserScript(
                WKUserScript(
                    source: runtimeScript,
                    injectionTime: .atDocumentEnd,
                    forMainFrameOnly: true
                )
            )
        }
        configuration.userContentController.addScriptMessageHandler(
            nativeBridge,
            contentWorld: .page,
            name: "nativeBridge"
        )

        let webView = MemoWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.keyboardDismissMode = .interactive
        webView.inputAssistantItem.leadingBarButtonGroups = []
        webView.inputAssistantItem.trailingBarButtonGroups = []
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.accessibilityIdentifier = "prototype-webview"
        return webView
    }()

    private lazy var nativeBridge = NativeBridge(owner: self)
    private let nativeHeader = MemoNativeHeaderView()
    private var currentAuth = AuthSnapshot(isAuthenticated: false, user: nil)
    private var currentScreenID = ""
    private var drawerScrim: UIControl?
    private var drawerPanel: UIView?

    override var prefersStatusBarHidden: Bool { false }
    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .bottom }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var shouldAutorotate: Bool { false }

    private static let prototypeBootstrapScript = """
    (() => {
      const style = document.createElement('style');
      style.id = 'memo-ios-cjk-font-fallback';
      style.textContent = `
        @font-face {
          font-family: 'Memo CJK Sans';
          src: local('PingFang SC');
          unicode-range:
            U+2E80-2FFF, U+3000-303F, U+31C0-31EF, U+3400-4DBF,
            U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF;
        }
        :root {
          --font-body: 'Memo CJK Sans', 'Geist', -apple-system,
            'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
          --memo-safe-top: env(safe-area-inset-top);
          --memo-safe-bottom: env(safe-area-inset-bottom);
          --memo-native-header-height: 56px;
          --home-bar: max(34px, var(--memo-safe-bottom));
          --memo-viewport-height: 100dvh;
          --memo-viewport-offset-top: 0px;
        }
        html, body, button, input, textarea {
          font-family: 'Memo CJK Sans', 'Geist', -apple-system,
            'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
        }
        .screen .phone-frame {
          width: 100vw !important;
          height: var(--memo-viewport-height) !important;
          position: absolute !important;
          inset: var(--memo-viewport-offset-top) 0 auto !important;
          transform: none !important;
        }
        .screen .phone-screen {
          padding-top: var(--memo-safe-top) !important;
        }
        html.memo-native-header-visible .screen.active .phone-screen {
          padding-top:
            calc(var(--memo-safe-top) + var(--memo-native-header-height)) !important;
        }
        #s-01-home .topbar-actions .icon-btn,
        #s-02-home-empty .top-thin {
          display: none !important;
        }
        .screen .dynamic-island,
        .screen .status-bar,
        .screen .home-indicator {
          display: none !important;
        }
        #s-06-detail-article .top-nav-bar {
          position: sticky !important;
          top: 0;
          z-index: 30;
          background: linear-gradient(
            to bottom,
            rgba(250, 250, 247, 0.98),
            rgba(250, 250, 247, 0.9)
          );
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
      `;
      document.head.appendChild(style);

      const syncVisualViewport = () => {
        const viewport = window.visualViewport;
        document.documentElement.style.setProperty(
          '--memo-viewport-height',
          `${viewport?.height || window.innerHeight}px`
        );
        document.documentElement.style.setProperty(
          '--memo-viewport-offset-top',
          `${viewport?.offsetTop || 0}px`
        );
      };
      syncVisualViewport();
      window.visualViewport?.addEventListener('resize', syncVisualViewport);
      window.visualViewport?.addEventListener('scroll', syncVisualViewport);

      const exposeButton = (selector, label) => {
        const element = document.querySelector(selector);
        if (!element) return;
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', label);
      };

      exposeButton('#s-01-home .topbar-actions .icon-btn', '搜索');
      exposeButton('#s-02-home-empty .top-thin .icon-btn', '设置');
      exposeButton('#s-02-home-empty .empty-cta', '添加第 1 条');
      exposeButton('#s-04-detail-podcast .hero-nav .icon-btn', '返回');
      exposeButton('#s-04-detail-podcast .hero-nav .right .icon-btn:first-child', '分享');
      exposeButton('#s-04-detail-podcast .hero-nav .right .icon-btn:nth-child(2)', '打开原始内容');
      exposeButton('#s-04-detail-podcast .hero-play', '打开原内容播放');
      exposeButton('#s-04-detail-podcast .action-bar .icon-btn:first-child', '从收藏中移除');
      exposeButton('#s-04-detail-podcast .action-bar .icon-btn:nth-child(2)', '标记为喜欢');
      exposeButton('#s-06-detail-article .nav-pill', '返回');
      exposeButton('#s-06-detail-article .nav-actions .nav-btn:first-child', '分享');
      exposeButton('#s-06-detail-article .nav-actions .nav-btn:nth-child(2)', '更多');
      exposeButton('#s-06-detail-article .tag-section .edit', '编辑 Tag');
      exposeButton('#s-06-detail-article .float-actions .float-btn:first-child', '查看引用');
      exposeButton('#s-06-detail-article .float-actions .float-btn:last-child', '删除收藏');
      exposeButton('#s-10-unsupported .alert-actions .btn:first-child', '不保留');
      exposeButton('#s-10-unsupported .alert-actions .btn:nth-child(2)', '保留链接');
      exposeButton('#s-11-edit-tags .btn-save', '保存修改');
      exposeButton('#s-11-edit-tags .btn-cancel', '取消编辑');

      const labelInput = (selector, label) => {
        const element = document.querySelector(selector);
        if (element) element.setAttribute('aria-label', label);
      };
      labelInput('#s-03-add .sheet-input', '内容链接');
      labelInput('#s-08-search .search-input input', '搜索收藏');
      labelInput('#s-11-edit-tags .add-tag-input input', '添加新 Tag');
      labelInput('#s-13-auth-login input[name="identifier"]', '登录手机号或者邮箱');
      labelInput('#s-13-auth-login input[name="password"]', '登录密码');
      labelInput('#s-14-auth-register input[name="nickname"]', '昵称');
      labelInput('#s-14-auth-register input[name="identifier"]', '注册手机号或者邮箱');
      labelInput('#s-14-auth-register input[name="password"]', '注册密码');

      document.querySelectorAll('.tab-add').forEach((element) => {
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', '添加');
      });

      document.querySelectorAll('#s-08-search .result-item').forEach((element) => {
        const title = element.querySelector('.title')?.textContent?.trim();
        if (!title) return;
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', title);
      });
    })();
    """

    private static let runtimeScript: String? = {
        guard let url = Bundle.main.url(
            forResource: "AppRuntime",
            withExtension: "js"
        ) else {
            return nil
        }
        return try? String(contentsOf: url, encoding: .utf8)
    }()

    override func loadView() {
        let container = UIView()
        container.backgroundColor = .systemBackground
        view = container

        webView.translatesAutoresizingMaskIntoConstraints = false
        nativeHeader.translatesAutoresizingMaskIntoConstraints = false
        nativeHeader.isHidden = true
        container.addSubview(webView)
        container.addSubview(nativeHeader)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),

            nativeHeader.topAnchor.constraint(
                equalTo: container.safeAreaLayoutGuide.topAnchor
            ),
            nativeHeader.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            nativeHeader.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            nativeHeader.heightAnchor.constraint(equalToConstant: 56),
        ])
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        nativeHeader.menuButton.addTarget(
            self,
            action: #selector(openDrawer),
            for: .touchUpInside
        )
        nativeHeader.searchButton.addTarget(
            self,
            action: #selector(openSearch),
            for: .touchUpInside
        )
        loadPrototype()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        applySafeAreaInsets()
    }

    func updateAuthSnapshot(_ snapshot: AuthSnapshot) {
        currentAuth = snapshot
        if !snapshot.isAuthenticated {
            closeDrawer(animated: false)
        }
        updateHeaderVisibility()
    }

    func updateNativeRoute(_ screenID: String) {
        currentScreenID = screenID
        updateHeaderVisibility()
    }

    func presentNativeSettings() {
        guard let user = currentAuth.user else { return }
        closeDrawer(animated: false)
        let settings = MemoSettingsViewController(
            user: user,
            onChangePassword: { [weak self] currentPassword, newPassword in
                guard let self else { return }
                let auth = try await AuthStore.shared.changePassword(
                    currentPassword: currentPassword,
                    newPassword: newPassword
                )
                self.updateAuthSnapshot(auth)
            },
            onDeleteAccount: { [weak self] currentPassword in
                guard let self else { return }
                let ownerID = user.id
                try await AuthStore.shared.deleteAccount(
                    currentPassword: currentPassword
                )
                try await LibraryStore.shared.deleteProfile(ownerID: ownerID)
                self.finishAuthenticationExit(eventName: "accountDeleted")
            },
            onLogout: { [weak self] in
                guard let self else { return }
                await AuthStore.shared.logout()
                try? await LibraryStore.shared.deactivate()
                self.finishAuthenticationExit(eventName: "loggedOut")
            }
        )
        let navigation = UINavigationController(rootViewController: settings)
        navigation.modalPresentationStyle = .fullScreen
        present(navigation, animated: true)
    }

    private func finishAuthenticationExit(eventName: String) {
        updateAuthSnapshot(AuthSnapshot(isAuthenticated: false, user: nil))
        dismiss(animated: true) { [weak self] in
            self?.sendNativeEvent(name: eventName, payload: [:])
        }
    }

    private func updateHeaderVisibility() {
        let shouldShow = currentAuth.isAuthenticated
            && ["01-home", "02-home-empty"].contains(currentScreenID)
        nativeHeader.isHidden = !shouldShow
        webView.evaluateJavaScript(
            "document.documentElement.classList.toggle(" +
            "'memo-native-header-visible', \(shouldShow ? "true" : "false"));"
        )
        if !shouldShow {
            closeDrawer(animated: false)
        }
    }

    @objc private func openSearch() {
        closeDrawer(animated: false)
        webView.evaluateJavaScript("window.MemoRuntime?.openSearch();")
    }

    @objc private func openDrawer() {
        guard drawerPanel == nil, let user = currentAuth.user else { return }

        let scrim = UIControl()
        scrim.translatesAutoresizingMaskIntoConstraints = false
        scrim.backgroundColor = UIColor.black.withAlphaComponent(0.28)
        scrim.alpha = 0
        scrim.accessibilityLabel = "关闭侧边栏"
        scrim.accessibilityTraits = .button
        scrim.isAccessibilityElement = true
        scrim.addTarget(self, action: #selector(closeDrawerFromControl), for: .touchUpInside)

        let panel = makeDrawerPanel(user: user)
        panel.translatesAutoresizingMaskIntoConstraints = false
        let panelWidth = min(view.bounds.width * 0.84, 340)

        view.addSubview(scrim)
        view.addSubview(panel)
        NSLayoutConstraint.activate([
            scrim.topAnchor.constraint(equalTo: view.topAnchor),
            scrim.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrim.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrim.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            panel.topAnchor.constraint(equalTo: view.topAnchor),
            panel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            panel.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            panel.widthAnchor.constraint(equalToConstant: panelWidth),
        ])
        view.layoutIfNeeded()
        panel.transform = CGAffineTransform(translationX: -panelWidth, y: 0)
        drawerScrim = scrim
        drawerPanel = panel
        UIView.animate(
            withDuration: 0.28,
            delay: 0,
            options: [.curveEaseOut, .allowUserInteraction]
        ) {
            scrim.alpha = 1
            panel.transform = .identity
        }
    }

    private func makeDrawerPanel(user: AuthUser) -> UIView {
        let panel = UIView()
        panel.backgroundColor = .systemBackground
        panel.layer.cornerRadius = 28
        panel.layer.maskedCorners = [.layerMaxXMinYCorner, .layerMaxXMaxYCorner]
        panel.layer.shadowColor = UIColor.black.cgColor
        panel.layer.shadowOpacity = 0.12
        panel.layer.shadowRadius = 24
        panel.layer.shadowOffset = CGSize(width: 8, height: 0)

        let avatar = UILabel()
        avatar.text = String(user.nickname.prefix(1)).uppercased()
        avatar.font = .preferredFont(forTextStyle: .title2)
        avatar.adjustsFontForContentSizeCategory = true
        avatar.textAlignment = .center
        avatar.textColor = .white
        avatar.backgroundColor = .label
        avatar.layer.cornerRadius = 28
        avatar.clipsToBounds = true
        avatar.translatesAutoresizingMaskIntoConstraints = false

        let nameLabel = UILabel()
        nameLabel.text = user.nickname
        nameLabel.font = .preferredFont(forTextStyle: .title2)
        nameLabel.adjustsFontForContentSizeCategory = true
        nameLabel.textColor = .label

        let identifierLabel = UILabel()
        identifierLabel.text = maskedIdentifier(user.primaryIdentifier)
        identifierLabel.font = .preferredFont(forTextStyle: .subheadline)
        identifierLabel.adjustsFontForContentSizeCategory = true
        identifierLabel.textColor = .secondaryLabel

        let labels = UIStackView(arrangedSubviews: [nameLabel, identifierLabel])
        labels.axis = .vertical
        labels.spacing = 4
        labels.translatesAutoresizingMaskIntoConstraints = false

        let settingsButton = UIButton(type: .system)
        var configuration = UIButton.Configuration.filled()
        configuration.title = "设置"
        configuration.image = UIImage(systemName: "gearshape")
        configuration.imagePadding = 12
        configuration.baseForegroundColor = .label
        configuration.baseBackgroundColor = .secondarySystemBackground
        configuration.cornerStyle = .large
        configuration.contentInsets = NSDirectionalEdgeInsets(
            top: 16,
            leading: 18,
            bottom: 16,
            trailing: 18
        )
        settingsButton.configuration = configuration
        settingsButton.contentHorizontalAlignment = .leading
        settingsButton.accessibilityIdentifier = "设置"
        settingsButton.addTarget(
            self,
            action: #selector(drawerSettingsTapped),
            for: .touchUpInside
        )
        settingsButton.translatesAutoresizingMaskIntoConstraints = false

        [avatar, labels, settingsButton].forEach { panel.addSubview($0) }
        NSLayoutConstraint.activate([
            avatar.topAnchor.constraint(
                equalTo: panel.safeAreaLayoutGuide.topAnchor,
                constant: 28
            ),
            avatar.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 24),
            avatar.widthAnchor.constraint(equalToConstant: 56),
            avatar.heightAnchor.constraint(equalToConstant: 56),

            labels.leadingAnchor.constraint(equalTo: avatar.trailingAnchor, constant: 14),
            labels.centerYAnchor.constraint(equalTo: avatar.centerYAnchor),
            labels.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -20),

            settingsButton.topAnchor.constraint(equalTo: avatar.bottomAnchor, constant: 32),
            settingsButton.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 20),
            settingsButton.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -20),
            settingsButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 52),
        ])

        let swipe = UISwipeGestureRecognizer(
            target: self,
            action: #selector(closeDrawerFromControl)
        )
        swipe.direction = .left
        panel.addGestureRecognizer(swipe)
        return panel
    }

    @objc private func drawerSettingsTapped() {
        presentNativeSettings()
    }

    @objc private func closeDrawerFromControl() {
        closeDrawer(animated: true)
    }

    private func closeDrawer(animated: Bool) {
        guard let panel = drawerPanel, let scrim = drawerScrim else { return }
        let cleanup = {
            panel.removeFromSuperview()
            scrim.removeFromSuperview()
            self.drawerPanel = nil
            self.drawerScrim = nil
        }
        guard animated else {
            cleanup()
            return
        }
        UIView.animate(
            withDuration: 0.22,
            delay: 0,
            options: [.curveEaseIn, .allowUserInteraction]
        ) {
            panel.transform = CGAffineTransform(
                translationX: -panel.bounds.width,
                y: 0
            )
            scrim.alpha = 0
        } completion: { _ in
            cleanup()
        }
    }

    private func maskedIdentifier(_ identifier: String) -> String {
        if let at = identifier.firstIndex(of: "@") {
            let name = identifier[..<at]
            let domain = identifier[identifier.index(after: at)...]
            return "\(name.prefix(2))***@\(domain)"
        }
        let digits = identifier.filter(\.isNumber)
        guard digits.count > 7 else { return identifier }
        return "\(digits.prefix(3)) **** \(digits.suffix(4))"
    }

    private func loadPrototype() {
        guard let htmlURL = Bundle.main.url(forResource: "app", withExtension: "html"),
              let resourceURL = Bundle.main.resourceURL else {
            showMissingPrototypeError()
            return
        }

        let requestedScreen = ProcessInfo.processInfo.environment["KNOWLEDGE_SCREEN"]
        let screenID = requestedScreen.flatMap { screenID in
            Self.validScreenIDs.contains(screenID) ? screenID : nil
        } ?? "01-home"

        guard let routedURL = URL(string: "\(htmlURL.absoluteString)#\(screenID)") else {
            showMissingPrototypeError()
            return
        }

        webView.loadFileURL(routedURL, allowingReadAccessTo: resourceURL)
    }

    private func showMissingPrototypeError() {
        let label = UILabel()
        label.text = "无法加载内置原型"
        label.textAlignment = .center
        label.textColor = .label
        label.backgroundColor = .systemBackground
        view = label
    }

    func sendNativeEvent(name: String, payload: Any) {
        guard JSONSerialization.isValidJSONObject([
            "name": name,
            "payload": payload,
        ]),
        let data = try? JSONSerialization.data(
            withJSONObject: ["name": name, "payload": payload]
        ),
        let json = String(data: data, encoding: .utf8) else {
            return
        }
        webView.evaluateJavaScript(
            "window.MemoRuntime?.nativeEvent(\(json));"
        )
    }

    func dismissKeyboard() {
        webView.evaluateJavaScript(
            "document.activeElement instanceof HTMLElement && document.activeElement.blur();"
        ) { [weak self] _, _ in
            self?.webView.endEditing(true)
            self?.view.endEditing(true)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        applySafeAreaInsets()
    }

    private func applySafeAreaInsets() {
        let top = view.safeAreaInsets.top
        let bottom = view.safeAreaInsets.bottom
        webView.evaluateJavaScript(
            "document.documentElement.style.setProperty('--memo-safe-top', '\(top)px');" +
            "document.documentElement.style.setProperty('--memo-safe-bottom', '\(bottom)px');"
        )
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if url.isFileURL || url.scheme == "about" {
            decisionHandler(.allow)
            return
        }

        if navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }
}
