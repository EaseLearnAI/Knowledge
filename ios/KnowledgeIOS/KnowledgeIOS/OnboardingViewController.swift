import UIKit

final class OnboardingViewController: UIViewController {
    var onComplete: (() async throws -> Void)?

    private let stepLabel = UILabel()
    private let heroImage = UIImageView()
    private let titleLabel = UILabel()
    private let bodyLabel = UILabel()
    private let pageControl = UIPageControl()
    private let actionButton = UIButton(type: .system)
    private var page = ProcessInfo.processInfo.environment[
        "KNOWLEDGE_ONBOARDING_PAGE"
    ] == "2" ? 1 : 0

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MemoStyle.warmBackground
        navigationItem.hidesBackButton = true
        configureContent()
        renderPage()
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
        stepLabel.font = .systemFont(ofSize: 15, weight: .bold)
        stepLabel.textColor = .white
        stepLabel.textAlignment = .center
        stepLabel.backgroundColor = MemoStyle.orange
        stepLabel.layer.cornerRadius = 15
        stepLabel.layer.masksToBounds = true
        stepLabel.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.font = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(
            for: .systemFont(ofSize: 35, weight: .bold)
        )
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textColor = .label
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0

        heroImage.contentMode = .scaleAspectFill
        heroImage.clipsToBounds = true
        heroImage.isAccessibilityElement = true
        heroImage.translatesAutoresizingMaskIntoConstraints = false

        bodyLabel.font = UIFontMetrics(forTextStyle: .body).scaledFont(
            for: .systemFont(ofSize: 17, weight: .regular)
        )
        bodyLabel.adjustsFontForContentSizeCategory = true
        bodyLabel.textColor = .secondaryLabel
        bodyLabel.textAlignment = .center
        bodyLabel.numberOfLines = 0

        pageControl.numberOfPages = 2
        pageControl.currentPage = 0
        pageControl.currentPageIndicatorTintColor = MemoStyle.orange
        pageControl.pageIndicatorTintColor = MemoStyle.orange.withAlphaComponent(0.18)
        pageControl.isUserInteractionEnabled = false

        actionButton.configuration = MemoStyle.accentButtonConfiguration(
            title: "下一步"
        )
        actionButton.addTarget(
            self,
            action: #selector(actionTapped),
            for: .touchUpInside
        )

        let contentStack = UIStackView(
            arrangedSubviews: [
                stepLabel,
                titleLabel,
                heroImage,
                bodyLabel,
            ]
        )
        contentStack.axis = .vertical
        contentStack.alignment = .center
        contentStack.spacing = 0
        contentStack.setCustomSpacing(18, after: stepLabel)
        contentStack.setCustomSpacing(24, after: titleLabel)
        contentStack.setCustomSpacing(18, after: heroImage)
        contentStack.translatesAutoresizingMaskIntoConstraints = false

        let footerStack = UIStackView(
            arrangedSubviews: [pageControl, actionButton]
        )
        footerStack.axis = .vertical
        footerStack.alignment = .fill
        footerStack.spacing = 18
        footerStack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(contentStack)
        view.addSubview(footerStack)

        NSLayoutConstraint.activate([
            stepLabel.widthAnchor.constraint(equalToConstant: 58),
            stepLabel.heightAnchor.constraint(equalToConstant: 30),

            contentStack.topAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.topAnchor,
                constant: 36
            ),
            contentStack.leadingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.leadingAnchor,
                constant: 24
            ),
            contentStack.trailingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.trailingAnchor,
                constant: -24
            ),
            heroImage.widthAnchor.constraint(equalTo: contentStack.widthAnchor),
            heroImage.heightAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.heightAnchor,
                multiplier: 0.32
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
            contentStack.bottomAnchor.constraint(
                lessThanOrEqualTo: footerStack.topAnchor,
                constant: -18
            ),
            actionButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 52),
        ])
    }

    private func renderPage() {
        if page == 0 {
            stepLabel.text = "01"
            heroImage.image = UIImage(named: "OnboardingProblem")
            heroImage.accessibilityLabel = "堆积的收藏被整理成可以重新使用的知识"
            titleLabel.text = "别再让收藏夹吃灰"
            titleLabel.accessibilityIdentifier = "收藏夹吃灰"
            bodyLabel.text = "收藏不是终点。Memo 把视频和文章提炼成摘要、要点和 Tag，让值得看的内容真正被再次用起来。"
            actionButton.configuration?.title = "下一步"
            actionButton.accessibilityLabel = "下一步"
            actionButton.accessibilityIdentifier = "下一步"
        } else {
            stepLabel.text = "02"
            heroImage.image = UIImage(named: "OnboardingHowItWorks")
            heroImage.accessibilityLabel = "一个链接自动生成摘要、要点和 Tag"
            titleLabel.text = "只需发来一个链接"
            titleLabel.accessibilityIdentifier = "发一个链接"
            bodyLabel.text = "把 B 站、小红书、抖音或网页链接发到 Memo，自动分析内容，形成属于你的知识库。"
            actionButton.configuration?.title = "开始使用"
            actionButton.accessibilityLabel = "开始使用"
            actionButton.accessibilityIdentifier = "开始使用"
        }
        pageControl.currentPage = page
    }

    @objc private func actionTapped() {
        if page == 0 {
            page = 1
            UIView.transition(
                with: view,
                duration: 0.2,
                options: .transitionCrossDissolve
            ) {
                self.renderPage()
            }
            return
        }

        guard let onComplete else { return }
        actionButton.isEnabled = false
        actionButton.configuration?.showsActivityIndicator = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await onComplete()
            } catch {
                actionButton.isEnabled = true
                actionButton.configuration?.showsActivityIndicator = false
                MemoStyle.showError(error, on: self)
            }
        }
    }
}
