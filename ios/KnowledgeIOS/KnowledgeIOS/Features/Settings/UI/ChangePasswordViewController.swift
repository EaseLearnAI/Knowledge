import UIKit

final class ChangePasswordViewController: UIViewController {
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
        configure(currentPassword, placeholder: "当前密码", label: "当前密码")
        configure(newPassword, placeholder: "新密码", label: "新密码")
        configure(confirmPassword, placeholder: "再次输入新密码", label: "确认新密码")

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
        label: String
    ) {
        field.placeholder = placeholder
        field.isSecureTextEntry = true
        field.textContentType = label == "当前密码" ? .password : .newPassword
        field.borderStyle = .roundedRect
        field.font = .preferredFont(forTextStyle: .body)
        field.adjustsFontForContentSizeCategory = true
        field.accessibilityLabel = label
        field.accessibilityIdentifier = label
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
    }

    private func configureLayout() {
        let hint = MemoStyle.label(
            text: "至少 8 位，并同时包含字母和数字。",
            style: .footnote,
            color: .secondaryLabel
        )
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
        guard new == confirmPassword.text ?? "" else {
            let error = NSError(
                domain: "Memo",
                code: 1,
                userInfo: [
                    NSLocalizedDescriptionKey: "两次输入的新密码不一致",
                ]
            )
            MemoStyle.showError(error, on: self, title: "无法修改密码")
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
                MemoStyle.showError(error, on: self, title: "无法修改密码")
            }
        }
    }
}
