import UIKit

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
