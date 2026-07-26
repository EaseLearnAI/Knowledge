import UIKit

final class AuthIntroViewController: UIViewController {
    var onCreateAccount: (() -> Void)?
    var onLogin: (() -> Void)?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MemoStyle.warmBackground
        navigationItem.hidesBackButton = true
        configureContent()
    }

    private func configureContent() {
        let mark = MemoStyle.label(
            text: "MEMO",
            style: .caption1,
            color: .secondaryLabel,
            alignment: .center,
            lines: 1
        )

        let symbol = UIImageView(
            image: UIImage(
                systemName: "books.vertical.fill",
                withConfiguration: UIImage.SymbolConfiguration(
                    pointSize: 68,
                    weight: .medium
                )
            )
        )
        symbol.tintColor = MemoStyle.orange
        symbol.contentMode = .scaleAspectFit
        symbol.accessibilityLabel = "知识收藏"

        let title = MemoStyle.label(
            text: "把值得看的，\n变成真正用得上的知识",
            style: .largeTitle,
            alignment: .center
        )
        title.font = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(
            for: .systemFont(ofSize: 34, weight: .bold)
        )
        title.accessibilityIdentifier = "把值得看的"

        let body = MemoStyle.label(
            text: "收藏 B 站、小红书、抖音和网页链接。\nMemo 自动提取内容、生成摘要，让收藏不再吃灰。",
            style: .body,
            color: .secondaryLabel,
            alignment: .center
        )

        let create = MemoStyle.primaryButton(title: "创建账号")
        create.addTarget(self, action: #selector(createTapped), for: .touchUpInside)
        let login = MemoStyle.secondaryButton(title: "登录")
        login.addTarget(self, action: #selector(loginTapped), for: .touchUpInside)

        let actions = UIStackView(arrangedSubviews: [create, login])
        actions.axis = .vertical
        actions.spacing = 12

        let content = UIStackView(
            arrangedSubviews: [mark, symbol, title, body, actions]
        )
        content.axis = .vertical
        content.alignment = .fill
        content.spacing = 24
        content.setCustomSpacing(12, after: mark)
        content.setCustomSpacing(32, after: symbol)
        content.setCustomSpacing(16, after: title)
        content.setCustomSpacing(36, after: body)
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)

        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.leadingAnchor,
                constant: 28
            ),
            content.trailingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.trailingAnchor,
                constant: -28
            ),
            content.centerYAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.centerYAnchor
            ),
            symbol.heightAnchor.constraint(equalToConstant: 88),
        ])
    }

    @objc private func createTapped() {
        onCreateAccount?()
    }

    @objc private func loginTapped() {
        onLogin?()
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
                ? "登录后继续查看你的收藏。"
                : "只需一个账号，收藏会按账号安全隔离。",
            style: .body,
            color: .secondaryLabel
        )

        var arranged: [UIView] = [heading, description]
        if mode == .register {
            arranged.append(nicknameField)
        }
        arranged.append(contentsOf: [
            identifierField,
            passwordField,
            submitButton,
        ])

        let stack = UIStackView(arrangedSubviews: arranged)
        stack.axis = .vertical
        stack.spacing = 14
        stack.setCustomSpacing(8, after: heading)
        stack.setCustomSpacing(32, after: description)
        stack.setCustomSpacing(24, after: passwordField)
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
