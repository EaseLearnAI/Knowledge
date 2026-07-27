import UIKit

final class AuthIntroViewController: UIViewController {
    var onContinue: (() -> Void)?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MemoStyle.warmBackground
        navigationItem.hidesBackButton = true
        configureContent()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: animated)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        navigationController?.setNavigationBarHidden(false, animated: animated)
    }

    private func configureContent() {
        let brand = UILabel()
        brand.text = "Memo"
        brand.font = .systemFont(ofSize: 13, weight: .semibold)
        brand.textColor = MemoStyle.orange
        brand.textAlignment = .center
        brand.backgroundColor = MemoStyle.orange.withAlphaComponent(0.1)
        brand.layer.cornerRadius = 13
        brand.layer.masksToBounds = true
        brand.translatesAutoresizingMaskIntoConstraints = false

        let eyebrow = MemoStyle.label(
            text: "你的个人内容知识库",
            style: .subheadline,
            color: .secondaryLabel,
            alignment: .center,
            lines: 1
        )

        let title = MemoStyle.label(
            text: "把值得看的，\n变成真正用得上的知识",
            style: .largeTitle,
            alignment: .center
        )
        title.font = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(
            for: .systemFont(ofSize: 36, weight: .bold)
        )
        title.accessibilityIdentifier = "把值得看的"

        let hero = UIImageView(image: UIImage(named: "IntroKnowledgeFlow"))
        hero.contentMode = .scaleAspectFill
        hero.clipsToBounds = true
        hero.isAccessibilityElement = true
        hero.accessibilityLabel = "视频、音频和网页被整理成知识卡片"

        let body = MemoStyle.label(
            text: "把 B 站、小红书、抖音和网页链接发给 Memo，\n自动提取内容、生成摘要和 Tag。",
            style: .body,
            color: .secondaryLabel,
            alignment: .center
        )
        body.font = UIFontMetrics(forTextStyle: .body).scaledFont(
            for: .systemFont(ofSize: 17, weight: .regular)
        )

        let support = MemoStyle.label(
            text: "B 站  ·  小红书  ·  抖音  ·  网页链接",
            style: .caption1,
            color: .tertiaryLabel,
            alignment: .center,
            lines: 1
        )

        let continueButton = MemoStyle.accentButton(title: "开始使用")
        continueButton.addTarget(
            self,
            action: #selector(continueTapped),
            for: .touchUpInside
        )

        let mainStack = UIStackView(
            arrangedSubviews: [eyebrow, title, hero, body]
        )
        mainStack.axis = .vertical
        mainStack.alignment = .fill
        mainStack.spacing = 0
        mainStack.setCustomSpacing(12, after: eyebrow)
        mainStack.setCustomSpacing(26, after: title)
        mainStack.setCustomSpacing(18, after: hero)
        mainStack.translatesAutoresizingMaskIntoConstraints = false

        let footerStack = UIStackView(
            arrangedSubviews: [continueButton, support]
        )
        footerStack.axis = .vertical
        footerStack.alignment = .fill
        footerStack.spacing = 16
        footerStack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(brand)
        view.addSubview(mainStack)
        view.addSubview(footerStack)

        NSLayoutConstraint.activate([
            brand.topAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.topAnchor,
                constant: 12
            ),
            brand.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            brand.widthAnchor.constraint(greaterThanOrEqualToConstant: 64),
            brand.heightAnchor.constraint(equalToConstant: 26),

            mainStack.topAnchor.constraint(
                equalTo: brand.bottomAnchor,
                constant: 34
            ),
            mainStack.leadingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.leadingAnchor,
                constant: 24
            ),
            mainStack.trailingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.trailingAnchor,
                constant: -24
            ),
            hero.heightAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.heightAnchor,
                multiplier: 0.29
            ),

            footerStack.leadingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.leadingAnchor,
                constant: 24
            ),
            footerStack.trailingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.trailingAnchor,
                constant: -24
            ),
            footerStack.bottomAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.bottomAnchor,
                constant: -22
            ),
            mainStack.bottomAnchor.constraint(
                lessThanOrEqualTo: footerStack.topAnchor,
                constant: -20
            ),
        ])
    }

    @objc private func continueTapped() {
        onContinue?()
    }
}

final class AuthFormViewController: UIViewController {
    enum Mode {
        case login
        case register

        var title: String {
            switch self {
            case .login: "登录"
            case .register: "创建账号"
            }
        }
    }

    var onSubmit: ((String, String, String?) async throws -> Void)?
    var onSwitchMode: ((Mode) -> Void)?

    private let mode: Mode
    private let nicknameField = UITextField()
    private let identifierField = UITextField()
    private let passwordField = UITextField()
    private let submitButton = UIButton(type: .system)

    init(mode: Mode) {
        self.mode = mode
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = mode.title
        view.backgroundColor = MemoStyle.warmBackground
        configureFields()
        configureContent()
    }

    private func configureFields() {
        configure(
            identifierField,
            placeholder: "手机号或邮箱",
            contentType: .username,
            identifier: mode == .login
                ? "登录手机号或者邮箱"
                : "注册手机号或者邮箱"
        )
        configure(
            passwordField,
            placeholder: "密码",
            contentType: .password,
            identifier: mode == .login ? "登录密码" : "注册密码"
        )
        passwordField.isSecureTextEntry = true
        passwordField.returnKeyType = .done
        let toolbar = UIToolbar()
        toolbar.sizeToFit()
        toolbar.items = [
            UIBarButtonItem(systemItem: .flexibleSpace),
            UIBarButtonItem(
                title: "完成",
                primaryAction: UIAction { [weak self] _ in
                    self?.view.endEditing(true)
                }
            ),
        ]
        passwordField.inputAccessoryView = toolbar

        if mode == .register {
            configure(
                nicknameField,
                placeholder: "昵称",
                contentType: .name,
                identifier: "昵称"
            )
            nicknameField.returnKeyType = .next
            nicknameField.addTarget(
                identifierField,
                action: #selector(UIResponder.becomeFirstResponder),
                for: .editingDidEndOnExit
            )
        }
        identifierField.returnKeyType = .next
        identifierField.addTarget(
            passwordField,
            action: #selector(UIResponder.becomeFirstResponder),
            for: .editingDidEndOnExit
        )
        passwordField.addTarget(
            self,
            action: #selector(submitTapped),
            for: .editingDidEndOnExit
        )

        var configuration = UIButton.Configuration.filled()
        configuration.title = mode.title
        configuration.baseBackgroundColor = .label
        configuration.baseForegroundColor = .systemBackground
        configuration.cornerStyle = .capsule
        configuration.contentInsets = NSDirectionalEdgeInsets(
            top: 15,
            leading: 24,
            bottom: 15,
            trailing: 24
        )
        submitButton.configuration = configuration
        submitButton.accessibilityIdentifier = mode == .login
            ? "提交登录"
            : "提交创建账号"
        submitButton.addTarget(
            self,
            action: #selector(submitTapped),
            for: .touchUpInside
        )
    }

    private func configure(
        _ field: UITextField,
        placeholder: String,
        contentType: UITextContentType,
        identifier: String
    ) {
        field.placeholder = placeholder
        field.textContentType = contentType
        field.font = .preferredFont(forTextStyle: .body)
        field.adjustsFontForContentSizeCategory = true
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.backgroundColor = .secondarySystemBackground
        field.layer.cornerRadius = 14
        field.layer.masksToBounds = true
        field.leftView = UIView(
            frame: CGRect(x: 0, y: 0, width: 16, height: 1)
        )
        field.leftViewMode = .always
        field.accessibilityLabel = identifier
        field.accessibilityIdentifier = identifier
        field.heightAnchor.constraint(greaterThanOrEqualToConstant: 54).isActive = true
    }

    private func configureContent() {
        let heading = MemoStyle.label(
            text: mode == .login ? "欢迎回来" : "建立你的知识库",
            style: .largeTitle,
            lines: 0
        )
        heading.font = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(
            for: .systemFont(ofSize: 32, weight: .bold)
        )

        let description = MemoStyle.label(
            text: mode == .login
                ? "继续查看你收藏过的内容。"
                : "创建账号后，开始建立自己的内容知识库。",
            style: .body,
            color: .secondaryLabel
        )

        let switchButton = UIButton(type: .system)
        var switchConfiguration = UIButton.Configuration.plain()
        switchConfiguration.title = mode == .login
            ? "还没有账号？创建账号"
            : "已有账号？登录"
        switchConfiguration.baseForegroundColor = MemoStyle.orange
        switchConfiguration.contentInsets = NSDirectionalEdgeInsets(
            top: 12,
            leading: 16,
            bottom: 12,
            trailing: 16
        )
        switchButton.configuration = switchConfiguration
        switchButton.titleLabel?.font = .preferredFont(forTextStyle: .subheadline)
        switchButton.titleLabel?.adjustsFontForContentSizeCategory = true
        switchButton.accessibilityIdentifier = mode == .login
            ? "切换到创建账号"
            : "切换到登录"
        switchButton.addTarget(
            self,
            action: #selector(switchModeTapped),
            for: .touchUpInside
        )

        var arranged: [UIView] = [heading, description]
        if mode == .register {
            arranged.append(nicknameField)
        }
        arranged.append(contentsOf: [
            identifierField,
            passwordField,
            submitButton,
            switchButton,
        ])

        let stack = UIStackView(arrangedSubviews: arranged)
        stack.axis = .vertical
        stack.spacing = 14
        stack.setCustomSpacing(8, after: heading)
        stack.setCustomSpacing(32, after: description)
        stack.setCustomSpacing(24, after: passwordField)
        stack.setCustomSpacing(8, after: submitButton)
        stack.translatesAutoresizingMaskIntoConstraints = false

        let scroll = UIScrollView()
        scroll.keyboardDismissMode = .interactive
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        scroll.addSubview(stack)

        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            stack.topAnchor.constraint(
                equalTo: scroll.contentLayoutGuide.topAnchor,
                constant: 36
            ),
            stack.leadingAnchor.constraint(
                equalTo: scroll.frameLayoutGuide.leadingAnchor,
                constant: 24
            ),
            stack.trailingAnchor.constraint(
                equalTo: scroll.frameLayoutGuide.trailingAnchor,
                constant: -24
            ),
            stack.bottomAnchor.constraint(
                lessThanOrEqualTo: scroll.contentLayoutGuide.bottomAnchor,
                constant: -24
            ),
        ])
    }

    @objc private func switchModeTapped() {
        onSwitchMode?(mode == .login ? .register : .login)
    }

    @objc private func submitTapped() {
        view.endEditing(true)
        guard let onSubmit else { return }
        setBusy(true)
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                // Allow the system keyboard dismissal animation to finish before
                // replacing the root navigation stack after authentication.
                try? await Task.sleep(for: .milliseconds(350))
                try await onSubmit(
                    identifierField.text ?? "",
                    passwordField.text ?? "",
                    mode == .register ? nicknameField.text : nil
                )
            } catch {
                setBusy(false)
                MemoStyle.showError(error, on: self, title: mode.title + "失败")
            }
        }
    }

    private func setBusy(_ busy: Bool) {
        [nicknameField, identifierField, passwordField].forEach {
            $0.isEnabled = !busy
        }
        submitButton.isEnabled = !busy
        submitButton.configuration?.showsActivityIndicator = busy
    }
}
