import UIKit

@MainActor
enum MemoStyle {
    static let accent = UIColor.label
    static let warmBackground = UIColor(
        red: 0.985,
        green: 0.979,
        blue: 0.963,
        alpha: 1
    )
    static let orange = UIColor(
        red: 0.86,
        green: 0.29,
        blue: 0.12,
        alpha: 1
    )

    static func configureNavigationBar(_ navigationBar: UINavigationBar) {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = .systemBackground
        appearance.shadowColor = .clear
        appearance.titleTextAttributes = [
            .foregroundColor: UIColor.label,
            .font: UIFont.preferredFont(forTextStyle: .headline),
        ]
        navigationBar.standardAppearance = appearance
        navigationBar.scrollEdgeAppearance = appearance
        navigationBar.compactAppearance = appearance
        navigationBar.tintColor = .label
    }

    static func primaryButton(title: String) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.filled()
        configuration.title = title
        configuration.baseBackgroundColor = .label
        configuration.baseForegroundColor = .systemBackground
        configuration.cornerStyle = .capsule
        configuration.contentInsets = NSDirectionalEdgeInsets(
            top: 15,
            leading: 24,
            bottom: 15,
            trailing: 24
        )
        button.configuration = configuration
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 52).isActive = true
        button.accessibilityIdentifier = title
        return button
    }

    static func accentButtonConfiguration(
        title: String
    ) -> UIButton.Configuration {
        var configuration = UIButton.Configuration.filled()
        configuration.title = title
        configuration.baseBackgroundColor = orange
        configuration.baseForegroundColor = .white
        configuration.cornerStyle = .capsule
        configuration.contentInsets = NSDirectionalEdgeInsets(
            top: 16,
            leading: 24,
            bottom: 16,
            trailing: 24
        )
        return configuration
    }

    static func accentButton(title: String) -> UIButton {
        let button = UIButton(type: .system)
        button.configuration = accentButtonConfiguration(title: title)
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 56).isActive = true
        button.accessibilityIdentifier = title
        return button
    }

    static func secondaryButton(title: String) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.gray()
        configuration.title = title
        configuration.baseForegroundColor = .label
        configuration.cornerStyle = .capsule
        configuration.contentInsets = NSDirectionalEdgeInsets(
            top: 15,
            leading: 24,
            bottom: 15,
            trailing: 24
        )
        button.configuration = configuration
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 52).isActive = true
        button.accessibilityIdentifier = title
        return button
    }

    static func iconBarButton(
        symbol: String,
        label: String,
        action: UIAction
    ) -> UIBarButtonItem {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 52, height: 44))
        container.translatesAutoresizingMaskIntoConstraints = false
        container.widthAnchor.constraint(equalToConstant: 52).isActive = true
        container.heightAnchor.constraint(equalToConstant: 44).isActive = true

        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.gray()
        configuration.image = UIImage(
            systemName: symbol,
            withConfiguration: UIImage.SymbolConfiguration(
                pointSize: 17,
                weight: .semibold
            )
        )
        configuration.baseForegroundColor = .label
        configuration.cornerStyle = .capsule
        button.configuration = configuration
        button.translatesAutoresizingMaskIntoConstraints = false
        button.accessibilityLabel = label
        button.accessibilityIdentifier = label
        button.addAction(action, for: .touchUpInside)
        container.addSubview(button)
        NSLayoutConstraint.activate([
            button.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            button.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            button.widthAnchor.constraint(equalToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: 44),
        ])
        return UIBarButtonItem(customView: container)
    }

    static func iconBarButton(
        symbol: String,
        label: String,
        target: Any?,
        action: Selector
    ) -> UIBarButtonItem {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 52, height: 44))
        container.translatesAutoresizingMaskIntoConstraints = false
        container.widthAnchor.constraint(equalToConstant: 52).isActive = true
        container.heightAnchor.constraint(equalToConstant: 44).isActive = true

        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.gray()
        configuration.image = UIImage(
            systemName: symbol,
            withConfiguration: UIImage.SymbolConfiguration(
                pointSize: 17,
                weight: .semibold
            )
        )
        configuration.baseForegroundColor = .label
        configuration.cornerStyle = .capsule
        button.configuration = configuration
        button.translatesAutoresizingMaskIntoConstraints = false
        button.accessibilityLabel = label
        button.accessibilityIdentifier = label
        button.addTarget(target, action: action, for: .touchUpInside)
        container.addSubview(button)
        NSLayoutConstraint.activate([
            button.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            button.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            button.widthAnchor.constraint(equalToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: 44),
        ])
        return UIBarButtonItem(customView: container)
    }

    static func label(
        text: String? = nil,
        style: UIFont.TextStyle,
        color: UIColor = .label,
        alignment: NSTextAlignment = .natural,
        lines: Int = 0
    ) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .preferredFont(forTextStyle: style)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = color
        label.textAlignment = alignment
        label.numberOfLines = lines
        return label
    }

    static func tagPill(_ tag: String) -> UILabel {
        let label = MemoTagPillLabel()
        label.text = "#\(tag)"
        label.font = .preferredFont(forTextStyle: .caption1)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = orange
        label.backgroundColor = orange.withAlphaComponent(0.11)
        label.layer.cornerRadius = 11
        label.clipsToBounds = true
        label.setContentHuggingPriority(.required, for: .horizontal)
        label.setContentCompressionResistancePriority(.required, for: .horizontal)
        label.accessibilityLabel = "标签 \(tag)"
        return label
    }

    static func showError(
        _ error: Error,
        on controller: UIViewController,
        title: String = "操作失败"
    ) {
        let alert = UIAlertController(
            title: title,
            message: error.localizedDescription,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        controller.present(alert, animated: true)
    }
}

final class MemoTagPillLabel: UILabel {
    private let insets = UIEdgeInsets(top: 6, left: 10, bottom: 6, right: 10)

    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: insets))
    }

    override var intrinsicContentSize: CGSize {
        let size = super.intrinsicContentSize
        return CGSize(
            width: size.width + insets.left + insets.right,
            height: size.height + insets.top + insets.bottom
        )
    }
}

final class MemoLoadingViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MemoStyle.warmBackground
        let spinner = UIActivityIndicatorView(style: .large)
        spinner.startAnimating()
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.accessibilityLabel = "正在加载"
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }
}

final class MemoDrawerViewController: UIViewController {
    var onSettings: (() -> Void)?
    var onDismiss: (() -> Void)?

    private let user: AuthUser

    init(user: AuthUser) {
        self.user = user
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        modalTransitionStyle = .crossDissolve
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.28)

        let dismissControl = UIControl()
        dismissControl.translatesAutoresizingMaskIntoConstraints = false
        dismissControl.accessibilityLabel = "关闭侧边栏"
        dismissControl.accessibilityIdentifier = "关闭侧边栏"
        dismissControl.accessibilityTraits = .button
        dismissControl.addTarget(
            self,
            action: #selector(dismissTapped),
            for: .touchUpInside
        )
        view.addSubview(dismissControl)

        let panel = UIView()
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.backgroundColor = .systemBackground
        panel.layer.cornerRadius = 28
        panel.layer.maskedCorners = [.layerMaxXMinYCorner, .layerMaxXMaxYCorner]
        view.addSubview(panel)

        let avatar = MemoStyle.label(
            text: String(user.nickname.prefix(1)).uppercased(),
            style: .title2,
            color: .white,
            alignment: .center,
            lines: 1
        )
        avatar.backgroundColor = .label
        avatar.layer.cornerRadius = 28
        avatar.clipsToBounds = true
        avatar.translatesAutoresizingMaskIntoConstraints = false

        let name = MemoStyle.label(text: user.nickname, style: .title2, lines: 1)
        name.accessibilityIdentifier = user.nickname
        let identifier = MemoStyle.label(
            text: maskedIdentifier(user.primaryIdentifier),
            style: .subheadline,
            color: .secondaryLabel,
            lines: 1
        )
        let account = UIStackView(arrangedSubviews: [name, identifier])
        account.axis = .vertical
        account.spacing = 4
        account.translatesAutoresizingMaskIntoConstraints = false

        let settings = UIButton(type: .system)
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
        settings.configuration = configuration
        settings.contentHorizontalAlignment = .leading
        settings.accessibilityIdentifier = "设置"
        settings.addTarget(
            self,
            action: #selector(settingsTapped),
            for: .touchUpInside
        )
        settings.translatesAutoresizingMaskIntoConstraints = false

        [avatar, account, settings].forEach { panel.addSubview($0) }
        let width = min(view.bounds.width * 0.84, 340)
        NSLayoutConstraint.activate([
            dismissControl.topAnchor.constraint(equalTo: view.topAnchor),
            dismissControl.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            dismissControl.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            dismissControl.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            panel.topAnchor.constraint(equalTo: view.topAnchor),
            panel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            panel.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            panel.widthAnchor.constraint(equalToConstant: width),

            avatar.topAnchor.constraint(
                equalTo: panel.safeAreaLayoutGuide.topAnchor,
                constant: 28
            ),
            avatar.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 24),
            avatar.widthAnchor.constraint(equalToConstant: 56),
            avatar.heightAnchor.constraint(equalToConstant: 56),

            account.leadingAnchor.constraint(equalTo: avatar.trailingAnchor, constant: 14),
            account.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -20),
            account.centerYAnchor.constraint(equalTo: avatar.centerYAnchor),

            settings.topAnchor.constraint(equalTo: avatar.bottomAnchor, constant: 32),
            settings.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 20),
            settings.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -20),
            settings.heightAnchor.constraint(greaterThanOrEqualToConstant: 52),
        ])

        let swipe = UISwipeGestureRecognizer(
            target: self,
            action: #selector(dismissTapped)
        )
        swipe.direction = .left
        panel.addGestureRecognizer(swipe)
    }

    @objc private func dismissTapped() {
        dismiss(animated: true, completion: onDismiss)
    }

    @objc private func settingsTapped() {
        dismiss(animated: true) { [weak self] in
            self?.onSettings?()
        }
    }
}

func maskedIdentifier(_ identifier: String) -> String {
    if let at = identifier.firstIndex(of: "@") {
        let name = identifier[..<at]
        let domain = identifier[identifier.index(after: at)...]
        return "\(name.prefix(2))***@\(domain)"
    }
    let digits = identifier.filter(\.isNumber)
    guard digits.count > 7 else { return identifier }
    return "\(digits.prefix(3)) **** \(digits.suffix(4))"
}
