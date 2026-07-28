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
            text: "把想学的，\n真正留下来",
            style: .largeTitle,
            alignment: .center
        )
        title.font = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(
            for: .systemFont(ofSize: 36, weight: .bold)
        )
        title.accessibilityIdentifier = "把想学的"

        let hero = UIImageView(image: UIImage(named: "IntroKnowledgeFlow"))
        hero.contentMode = .scaleAspectFill
        hero.clipsToBounds = true
        hero.isAccessibilityElement = true
        hero.accessibilityLabel = "有价值的视频被真正留下"

        let body = MemoStyle.label(
            text: "看到有价值的视频，分享给 Memo。",
            style: .body,
            color: .secondaryLabel,
            alignment: .center
        )
        body.font = UIFontMetrics(forTextStyle: .body).scaledFont(
            for: .systemFont(ofSize: 17, weight: .regular)
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

        let footerStack = UIStackView(arrangedSubviews: [continueButton])
        footerStack.axis = .vertical
        footerStack.alignment = .fill
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
