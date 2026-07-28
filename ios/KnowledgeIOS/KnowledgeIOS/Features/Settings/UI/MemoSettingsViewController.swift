import SafariServices
import UIKit

final class MemoSettingsViewController: UIViewController {
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
        var configuration = UIButton.Configuration.plain()
        configuration.title = "隐私政策"
        configuration.baseForegroundColor = .secondaryLabel
        configuration.contentInsets = NSDirectionalEdgeInsets(
            top: 12,
            leading: 16,
            bottom: 12,
            trailing: 16
        )
        privacy.configuration = configuration
        privacy.accessibilityIdentifier = "隐私政策"
        privacy.addTarget(self, action: #selector(privacyTapped), for: .touchUpInside)

        [makeAccountCard(), changePassword, deleteAccount, logout, privacy].forEach {
            content.addArrangedSubview($0)
        }
        content.setCustomSpacing(28, after: changePassword)
        content.setCustomSpacing(28, after: deleteAccount)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            content.topAnchor.constraint(
                equalTo: scrollView.contentLayoutGuide.topAnchor,
                constant: 20
            ),
            content.leadingAnchor.constraint(
                equalTo: scrollView.frameLayoutGuide.leadingAnchor,
                constant: 20
            ),
            content.trailingAnchor.constraint(
                equalTo: scrollView.frameLayoutGuide.trailingAnchor,
                constant: -20
            ),
            content.bottomAnchor.constraint(
                equalTo: scrollView.contentLayoutGuide.bottomAnchor,
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
        card.accessibilityIdentifier = "账号信息"

        let name = MemoStyle.label(text: user.nickname, style: .title2)
        let identifier = MemoStyle.label(
            text: maskedIdentifier(user.primaryIdentifier),
            style: .subheadline,
            color: .secondaryLabel
        )
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
        navigationController?.pushViewController(
            ChangePasswordViewController(onSubmit: onChangePassword),
            animated: true
        )
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
                self?.performDelete(
                    password: alert?.textFields?.first?.text ?? ""
                )
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
                MemoStyle.showError(error, on: self)
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
}
