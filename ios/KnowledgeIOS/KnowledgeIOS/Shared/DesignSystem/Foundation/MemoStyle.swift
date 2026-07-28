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
        label.font = .preferredFont(forTextStyle: .caption2)
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
