import UIKit

final class OnboardingViewController: UIViewController {
    var onComplete: (() async throws -> Void)?

    private let symbol = UIImageView()
    private let titleLabel = UILabel()
    private let bodyLabel = UILabel()
    private let pageControl = UIPageControl()
    private let actionButton = UIButton(type: .system)
    private var page = 0

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MemoStyle.warmBackground
        navigationItem.hidesBackButton = true
        configureContent()
        renderPage()
    }

    private func configureContent() {
        symbol.tintColor = MemoStyle.orange
        symbol.contentMode = .scaleAspectFit
        symbol.translatesAutoresizingMaskIntoConstraints = false
        symbol.isAccessibilityElement = false

        titleLabel.font = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(
            for: .systemFont(ofSize: 32, weight: .bold)
        )
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textColor = .label
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0

        bodyLabel.font = .preferredFont(forTextStyle: .body)
        bodyLabel.adjustsFontForContentSizeCategory = true
        bodyLabel.textColor = .secondaryLabel
        bodyLabel.textAlignment = .center
        bodyLabel.numberOfLines = 0

        pageControl.numberOfPages = 2
        pageControl.currentPage = 0
        pageControl.currentPageIndicatorTintColor = .label
        pageControl.pageIndicatorTintColor = .tertiaryLabel
        pageControl.isUserInteractionEnabled = false

        var configuration = UIButton.Configuration.filled()
        configuration.baseBackgroundColor = .label
        configuration.baseForegroundColor = .systemBackground
        configuration.cornerStyle = .capsule
        configuration.contentInsets = NSDirectionalEdgeInsets(
            top: 15,
            leading: 24,
            bottom: 15,
            trailing: 24
        )
        actionButton.configuration = configuration
        actionButton.addTarget(
            self,
            action: #selector(actionTapped),
            for: .touchUpInside
        )

        let stack = UIStackView(
            arrangedSubviews: [
                symbol,
                titleLabel,
                bodyLabel,
                pageControl,
                actionButton,
            ]
        )
        stack.axis = .vertical
        stack.alignment = .fill
        stack.spacing = 24
        stack.setCustomSpacing(34, after: symbol)
        stack.setCustomSpacing(14, after: titleLabel)
        stack.setCustomSpacing(34, after: bodyLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.leadingAnchor,
                constant: 28
            ),
            stack.trailingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.trailingAnchor,
                constant: -28
            ),
            stack.centerYAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.centerYAnchor
            ),
            symbol.heightAnchor.constraint(equalToConstant: 108),
            actionButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 52),
        ])
    }

    private func renderPage() {
        if page == 0 {
            symbol.image = UIImage(
                systemName: "bookmark.slash.fill",
                withConfiguration: UIImage.SymbolConfiguration(pointSize: 88)
            )
            titleLabel.text = "别再让收藏夹吃灰"
            titleLabel.accessibilityIdentifier = "收藏夹吃灰"
            bodyLabel.text = "值得看的内容越来越多，但收藏之后很少再打开。Memo 把视频和文章整理成可以重新使用的知识。"
            actionButton.configuration?.title = "下一步"
            actionButton.accessibilityLabel = "下一步"
            actionButton.accessibilityIdentifier = "下一步"
        } else {
            symbol.image = UIImage(
                systemName: "link.badge.plus",
                withConfiguration: UIImage.SymbolConfiguration(pointSize: 88)
            )
            titleLabel.text = "发一个链接，就完成收藏"
            titleLabel.accessibilityIdentifier = "发一个链接"
            bodyLabel.text = "把 B 站、小红书、抖音或网页链接发到 Memo，自动提取内容、生成摘要和 Tag。"
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
