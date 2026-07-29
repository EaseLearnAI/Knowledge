import UIKit

final class AddContentViewController: UIViewController {
    var onSubmit: ((String) async throws -> Void)?

    private let input = UITextView()
    private let submitButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "添加收藏"
        view.backgroundColor = MemoStyle.warmBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            systemItem: .close,
            primaryAction: UIAction { [weak self] _ in
                self?.dismiss(animated: true)
            }
        )
        configureContent()
    }

    private func configureContent() {
        let title = MemoStyle.label(
            text: "粘贴分享文案或链接",
            style: .largeTitle
        )
        title.font = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(
            for: .systemFont(ofSize: 32, weight: .bold)
        )
        let body = MemoStyle.label(
            text: "支持直接粘贴 B 站、小红书和抖音的分享文案，Memo 会自动识别其中的链接。",
            style: .body,
            color: .secondaryLabel
        )

        input.font = .preferredFont(forTextStyle: .body)
        input.adjustsFontForContentSizeCategory = true
        input.backgroundColor = .secondarySystemBackground
        input.layer.cornerRadius = 16
        input.textContainerInset = UIEdgeInsets(
            top: 16,
            left: 14,
            bottom: 16,
            right: 14
        )
        input.autocorrectionType = .no
        input.autocapitalizationType = .none
        input.keyboardType = .default
        input.accessibilityLabel = "内容链接"
        input.accessibilityIdentifier = "内容链接"
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
        input.inputAccessoryView = toolbar
        input.heightAnchor.constraint(greaterThanOrEqualToConstant: 136).isActive = true

        var configuration = UIButton.Configuration.filled()
        configuration.title = "收藏到 Memo"
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
        submitButton.accessibilityIdentifier = "收藏到 Memo"
        submitButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 52).isActive = true
        submitButton.addTarget(
            self,
            action: #selector(submitTapped),
            for: .touchUpInside
        )

        let privacy = MemoStyle.label(
            text: "仅在你主动收藏时读取来源内容。",
            style: .footnote,
            color: .tertiaryLabel,
            alignment: .center
        )
        let stack = UIStackView(
            arrangedSubviews: [title, body, input, submitButton, privacy]
        )
        stack.axis = .vertical
        stack.spacing = 14
        stack.setCustomSpacing(8, after: title)
        stack.setCustomSpacing(28, after: body)
        stack.setCustomSpacing(24, after: input)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.topAnchor,
                constant: 28
            ),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -22),
        ])
    }

    @objc private func submitTapped() {
        guard let onSubmit else { return }
        view.endEditing(true)
        setBusy(true)
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await onSubmit(input.text ?? "")
            } catch {
                setBusy(false)
                MemoStyle.showError(error, on: self, title: "无法收藏")
            }
        }
    }

    private func setBusy(_ busy: Bool) {
        input.isEditable = !busy
        submitButton.isEnabled = !busy
        submitButton.configuration?.showsActivityIndicator = busy
    }
}
