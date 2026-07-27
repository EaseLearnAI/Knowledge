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

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        input.becomeFirstResponder()
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

final class ProcessingViewController: UIViewController {
    var onReady: ((KnowledgeItem) -> Void)?

    private let application: MemoApplication
    private var item: KnowledgeItem
    private let statusLabel = MemoStyle.label(
        style: .title2,
        alignment: .center
    )
    private let detailLabel = MemoStyle.label(
        style: .body,
        color: .secondaryLabel,
        alignment: .center
    )
    private let etaLabel = MemoStyle.label(
        style: .subheadline,
        color: .secondaryLabel
    )
    private let percentLabel = MemoStyle.label(
        style: .subheadline,
        color: MemoStyle.orange,
        alignment: .right,
        lines: 1
    )
    private let progressView = UIProgressView(progressViewStyle: .default)
    private let retryButton = MemoStyle.primaryButton(title: "重试")
    private let symbolView = UIImageView()
    private var observationToken: UUID?

    init(application: MemoApplication, item: KnowledgeItem) {
        self.application = application
        self.item = item
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "处理中"
        view.backgroundColor = MemoStyle.warmBackground
        configureContent()
        render()
        observationToken = application.observeItem(id: item.id) { [weak self] item in
            self?.item = item
            self?.render()
        }
    }

    deinit {
        let application = application
        let id = item.id
        guard let observationToken else { return }
        Task { @MainActor in
            application.stopObservingItem(id: id, token: observationToken)
        }
    }

    private func configureContent() {
        let iconContainer = UIView()
        iconContainer.backgroundColor = MemoStyle.orange.withAlphaComponent(0.11)
        iconContainer.layer.cornerRadius = 32
        iconContainer.translatesAutoresizingMaskIntoConstraints = false
        iconContainer.widthAnchor.constraint(equalToConstant: 64).isActive = true
        iconContainer.heightAnchor.constraint(equalToConstant: 64).isActive = true

        symbolView.image = UIImage(
            systemName: "waveform.and.magnifyingglass",
            withConfiguration: UIImage.SymbolConfiguration(
                pointSize: 30,
                weight: .semibold
            )
        )
        symbolView.tintColor = MemoStyle.orange
        symbolView.contentMode = .scaleAspectFit
        symbolView.translatesAutoresizingMaskIntoConstraints = false
        iconContainer.addSubview(symbolView)
        NSLayoutConstraint.activate([
            symbolView.centerXAnchor.constraint(equalTo: iconContainer.centerXAnchor),
            symbolView.centerYAnchor.constraint(equalTo: iconContainer.centerYAnchor),
            symbolView.widthAnchor.constraint(equalToConstant: 36),
            symbolView.heightAnchor.constraint(equalToConstant: 36),
        ])

        progressView.progressTintColor = MemoStyle.orange
        progressView.trackTintColor = .tertiarySystemFill
        progressView.layer.cornerRadius = 4
        progressView.clipsToBounds = true
        progressView.transform = CGAffineTransform(scaleX: 1, y: 2)

        let progressMeta = UIStackView(arrangedSubviews: [etaLabel, percentLabel])
        progressMeta.axis = .horizontal
        progressMeta.alignment = .center
        progressMeta.distribution = .fill

        let backgroundTip = MemoStyle.label(
            text: "可以先返回首页，处理会在后台继续。",
            style: .caption1,
            color: .tertiaryLabel,
            alignment: .center
        )

        retryButton.addTarget(
            self,
            action: #selector(retryTapped),
            for: .touchUpInside
        )

        iconContainer.setContentHuggingPriority(.required, for: .horizontal)
        let iconRow = UIStackView(arrangedSubviews: [UIView(), iconContainer, UIView()])
        iconRow.axis = .horizontal
        iconRow.distribution = .equalCentering

        let stack = UIStackView(
            arrangedSubviews: [
                iconRow,
                statusLabel,
                detailLabel,
                progressView,
                progressMeta,
                backgroundTip,
                retryButton,
            ]
        )
        stack.axis = .vertical
        stack.alignment = .fill
        stack.spacing = 16
        stack.setCustomSpacing(24, after: iconRow)
        stack.setCustomSpacing(8, after: statusLabel)
        stack.setCustomSpacing(24, after: detailLabel)
        stack.setCustomSpacing(10, after: progressView)
        stack.setCustomSpacing(20, after: progressMeta)
        stack.translatesAutoresizingMaskIntoConstraints = false

        let card = UIView()
        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 28
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.08
        card.layer.shadowRadius = 24
        card.layer.shadowOffset = CGSize(width: 0, height: 10)
        card.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        view.addSubview(card)
        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 22),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -22),
            card.centerYAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.centerYAnchor,
                constant: -28
            ),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -26),
        ])
    }

    private func render() {
        statusLabel.text = item.status == .failed ? "处理失败" : item.statusText
        detailLabel.text = item.status == .failed ? item.errorMessage : stageDetail
        etaLabel.text = item.status == .failed ? nil : estimatedTime
        percentLabel.text = item.status == .failed
            ? nil
            : "\(Int((item.progress * 100).rounded()))%"
        progressView.progress = Float(item.progress)
        progressView.isHidden = item.status == .failed
        etaLabel.isHidden = item.status == .failed
        percentLabel.isHidden = item.status == .failed
        retryButton.isHidden = item.status != .failed
        symbolView.image = UIImage(
            systemName: item.status == .failed
                ? "exclamationmark.triangle.fill"
                : "waveform.and.magnifyingglass",
            withConfiguration: UIImage.SymbolConfiguration(
                pointSize: 30,
                weight: .semibold
            )
        )
        view.accessibilityIdentifier = "处理页面"

        if item.status == .ready {
            onReady?(item)
        }
    }

    private var stageDetail: String {
        switch item.status {
        case .queued:
            "任务已加入队列，马上开始解析。"
        case .fetching:
            "正在识别分享链接并读取原始视频。"
        case .extracting:
            "正在转写音频并提取可回看的正文。"
        case .enriching:
            "正在整理标题、摘要、核心要点和标签。"
        case .ready:
            "内容已经整理完成。"
        case .failed:
            item.errorMessage ?? "处理没有完成，请稍后重试。"
        }
    }

    private var estimatedTime: String {
        switch item.status {
        case .queued, .fetching:
            "预计还需 2–4 分钟"
        case .extracting:
            "预计还需 1–3 分钟"
        case .enriching:
            "预计不到 1 分钟"
        case .ready:
            "已完成"
        case .failed:
            ""
        }
    }

    @objc private func retryTapped() {
        retryButton.isEnabled = false
        retryButton.configuration?.showsActivityIndicator = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                item = try await application.retry(itemID: item.id)
                retryButton.isEnabled = true
                retryButton.configuration?.showsActivityIndicator = false
                render()
            } catch {
                retryButton.isEnabled = true
                retryButton.configuration?.showsActivityIndicator = false
                MemoStyle.showError(error, on: self)
            }
        }
    }
}

final class DetailViewController: UIViewController {
    var onDeleted: (() -> Void)?
    var onEditTags: ((KnowledgeItem) -> Void)?

    private let application: MemoApplication
    private var item: KnowledgeItem
    private let scrollView = UIScrollView()
    private let contentStack = UIStackView()
    private var observationToken: UUID?

    init(application: MemoApplication, item: KnowledgeItem) {
        self.application = application
        self.item = item
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = item.sourceName
        view.backgroundColor = MemoStyle.warmBackground
        configureNavigation()
        configureScrollView()
        render()
        observationToken = application.observeItem(id: item.id) { [weak self] item in
            self?.item = item
            self?.render()
        }
    }

    deinit {
        let application = application
        let id = item.id
        guard let observationToken else { return }
        Task { @MainActor in
            application.stopObservingItem(id: id, token: observationToken)
        }
    }

    private func configureNavigation() {
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(
                image: UIImage(systemName: "square.and.arrow.up"),
                primaryAction: UIAction { [weak self] _ in self?.share() }
            ),
            UIBarButtonItem(
                image: UIImage(systemName: "safari"),
                primaryAction: UIAction { [weak self] _ in self?.openSource() }
            ),
        ]
        navigationItem.rightBarButtonItems?[0].accessibilityLabel = "分享"
        navigationItem.rightBarButtonItems?[1].accessibilityLabel = "打开原始内容"
    }

    private func configureScrollView() {
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        view.addSubview(scrollView)

        contentStack.axis = .vertical
        contentStack.spacing = 20
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(contentStack)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            contentStack.topAnchor.constraint(
                equalTo: scrollView.contentLayoutGuide.topAnchor,
                constant: 24
            ),
            contentStack.leadingAnchor.constraint(
                equalTo: scrollView.frameLayoutGuide.leadingAnchor,
                constant: 22
            ),
            contentStack.trailingAnchor.constraint(
                equalTo: scrollView.frameLayoutGuide.trailingAnchor,
                constant: -22
            ),
            contentStack.bottomAnchor.constraint(
                equalTo: scrollView.contentLayoutGuide.bottomAnchor,
                constant: -32
            ),
        ])
    }

    private func render() {
        contentStack.arrangedSubviews.forEach {
            contentStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }

        let source = MemoStyle.label(
            text: item.sourceName.uppercased(),
            style: .caption1,
            color: .secondaryLabel
        )
        let titleLabel = MemoStyle.label(
            text: item.title,
            style: .title1
        )
        titleLabel.font = UIFontMetrics(forTextStyle: .title1).scaledFont(
            for: .systemFont(ofSize: 26, weight: .bold)
        )
        titleLabel.accessibilityIdentifier = item.title

        let summaryTitle = sectionTitle("一句话摘要")
        let summary = cardLabel(item.summary)
        let whyWorthWatchingTitle = sectionTitle("为什么值得看")
        let whyWorthWatching = cardLabel(item.whyWorthWatching ?? "")
        let keyPointsTitle = sectionTitle("核心要点")
        let keyPoints = keyPointsCard(item.keyPoints)
        let tagsTitle = sectionTitle("标签")
        let tags = tagsView(item.tags)
        let editTags = MemoStyle.secondaryButton(title: "编辑 Tag")
        editTags.addTarget(
            self,
            action: #selector(editTagsTapped),
            for: .touchUpInside
        )

        let favoriteTitle = item.favorite ? "取消喜欢" : "标记为喜欢"
        let favorite = MemoStyle.secondaryButton(title: favoriteTitle)
        favorite.accessibilityIdentifier = favoriteTitle
        favorite.addTarget(
            self,
            action: #selector(favoriteTapped),
            for: .touchUpInside
        )
        let delete = MemoStyle.secondaryButton(title: "删除收藏")
        delete.configuration?.baseForegroundColor = .systemRed
        delete.accessibilityIdentifier = "删除收藏"
        delete.addTarget(
            self,
            action: #selector(deleteTapped),
            for: .touchUpInside
        )

        [
            source,
            titleLabel,
            summaryTitle,
            summary,
            whyWorthWatchingTitle,
            whyWorthWatching,
            keyPointsTitle,
            keyPoints,
            tagsTitle,
            tags,
            editTags,
            favorite,
            delete,
        ].forEach { contentStack.addArrangedSubview($0) }
        contentStack.setCustomSpacing(32, after: titleLabel)
        contentStack.setCustomSpacing(8, after: summaryTitle)
        contentStack.setCustomSpacing(28, after: summary)
        contentStack.setCustomSpacing(8, after: whyWorthWatchingTitle)
        contentStack.setCustomSpacing(28, after: whyWorthWatching)
        contentStack.setCustomSpacing(8, after: keyPointsTitle)
        contentStack.setCustomSpacing(28, after: keyPoints)
        contentStack.setCustomSpacing(8, after: tagsTitle)
        contentStack.setCustomSpacing(12, after: tags)
        contentStack.setCustomSpacing(30, after: editTags)
    }

    private func sectionTitle(_ text: String) -> UILabel {
        MemoStyle.label(text: text, style: .headline)
    }

    private func cardLabel(_ text: String) -> UIView {
        let container = UIView()
        container.backgroundColor = .secondarySystemBackground
        container.layer.cornerRadius = 16
        let label = MemoStyle.label(
            text: text.isEmpty ? "暂无内容" : text,
            style: .body,
            color: text.isEmpty ? .secondaryLabel : .label
        )
        label.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(label)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: container.topAnchor, constant: 16),
            label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),
            label.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -16),
        ])
        return container
    }

    private func keyPointsCard(_ points: [String]) -> UIView {
        let container = UIView()
        container.backgroundColor = .secondarySystemBackground
        container.layer.cornerRadius = 18

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)

        if points.isEmpty {
            stack.addArrangedSubview(
                MemoStyle.label(
                    text: "暂无核心要点",
                    style: .body,
                    color: .secondaryLabel
                )
            )
        } else {
            for (index, point) in points.enumerated() {
                let number = MemoStyle.label(
                    text: "\(index + 1)",
                    style: .caption1,
                    color: .white,
                    alignment: .center,
                    lines: 1
                )
                number.backgroundColor = MemoStyle.orange
                number.layer.cornerRadius = 11
                number.clipsToBounds = true
                number.translatesAutoresizingMaskIntoConstraints = false
                number.widthAnchor.constraint(equalToConstant: 22).isActive = true
                number.heightAnchor.constraint(equalToConstant: 22).isActive = true

                let text = MemoStyle.label(text: point, style: .body)
                let row = UIStackView(arrangedSubviews: [number, text])
                row.axis = .horizontal
                row.alignment = .top
                row.spacing = 12
                stack.addArrangedSubview(row)
            }
        }

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 18),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -18),
        ])
        return container
    }

    private func tagsView(_ tags: [String]) -> UIView {
        guard !tags.isEmpty else {
            return cardLabel("还没有标签")
        }
        let stack = UIStackView(
            arrangedSubviews: tags.prefix(3).map(MemoStyle.tagPill)
        )
        stack.axis = .horizontal
        stack.alignment = .center
        stack.spacing = 8
        return stack
    }

    @objc private func editTagsTapped() {
        onEditTags?(item)
    }

    @objc private func favoriteTapped() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                item = try await application.toggleFavorite(itemID: item.id)
                render()
            } catch {
                MemoStyle.showError(error, on: self)
            }
        }
    }

    @objc private func deleteTapped() {
        let alert = UIAlertController(
            title: "删除这条收藏？",
            message: "摘要、Tag 和提取出的正文都会从设备中移除。",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(
            UIAlertAction(title: "删除", style: .destructive) { [weak self] _ in
                self?.performDelete()
            }
        )
        present(alert, animated: true)
    }

    private func performDelete() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await application.remove(itemID: item.id)
                onDeleted?()
            } catch {
                MemoStyle.showError(error, on: self)
            }
        }
    }

    private func share() {
        let text = "\(item.title)\n\n\(item.summary)\n\n\(item.sourceURL.absoluteString)"
        let activity = UIActivityViewController(
            activityItems: [text, item.sourceURL],
            applicationActivities: nil
        )
        present(activity, animated: true)
    }

    private func openSource() {
        UIApplication.shared.open(item.sourceURL)
    }
}

final class TagEditorViewController: UIViewController {
    var onSaved: ((KnowledgeItem) -> Void)?

    private let application: MemoApplication
    private var item: KnowledgeItem
    private var selectedTags: Set<String>
    private let customTagField = UITextField()
    private let tagStack = UIStackView()
    private let suggestions = ["产品", "学习", "灵感", "工作", "生活"]

    init(application: MemoApplication, item: KnowledgeItem) {
        self.application = application
        self.item = item
        selectedTags = Set(item.tags)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "编辑 Tag"
        view.backgroundColor = MemoStyle.warmBackground
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "保存",
            primaryAction: UIAction { [weak self] _ in self?.save() }
        )
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "保存修改"
        configureContent()
        renderSuggestions()
    }

    private func configureContent() {
        let intro = MemoStyle.label(
            text: "选择或输入 Tag，方便以后搜索和回看。",
            style: .body,
            color: .secondaryLabel
        )
        tagStack.axis = .vertical
        tagStack.spacing = 10

        customTagField.placeholder = "添加新 Tag"
        customTagField.font = .preferredFont(forTextStyle: .body)
        customTagField.adjustsFontForContentSizeCategory = true
        customTagField.backgroundColor = .secondarySystemBackground
        customTagField.layer.cornerRadius = 14
        customTagField.leftView = UIView(
            frame: CGRect(x: 0, y: 0, width: 16, height: 1)
        )
        customTagField.leftViewMode = .always
        customTagField.accessibilityIdentifier = "添加新 Tag"
        customTagField.returnKeyType = .done
        customTagField.addTarget(
            self,
            action: #selector(addCustomTag),
            for: .editingDidEndOnExit
        )
        customTagField.heightAnchor.constraint(greaterThanOrEqualToConstant: 52).isActive = true

        let add = MemoStyle.secondaryButton(title: "添加 Tag")
        add.addTarget(self, action: #selector(addCustomTag), for: .touchUpInside)

        let stack = UIStackView(
            arrangedSubviews: [intro, tagStack, customTagField, add]
        )
        stack.axis = .vertical
        stack.spacing = 16
        stack.setCustomSpacing(28, after: intro)
        stack.setCustomSpacing(28, after: tagStack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.topAnchor,
                constant: 24
            ),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -22),
        ])
    }

    private func renderSuggestions() {
        tagStack.arrangedSubviews.forEach {
            tagStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        for (index, tag) in suggestions.enumerated() {
            let button = MemoStyle.secondaryButton(
                title: selectedTags.contains(tag) ? "✓ \(tag)" : tag
            )
            button.accessibilityLabel = selectedTags.contains(tag)
                ? "移除 Tag \(tag)"
                : "添加 Tag \(tag)"
            button.accessibilityIdentifier = button.accessibilityLabel
            button.contentHorizontalAlignment = .leading
            button.tag = index
            button.addTarget(
                self,
                action: #selector(suggestionTapped(_:)),
                for: .touchUpInside
            )
            tagStack.addArrangedSubview(button)
        }
    }

    @objc private func suggestionTapped(_ sender: UIButton) {
        guard suggestions.indices.contains(sender.tag) else { return }
        toggle(suggestions[sender.tag])
    }

    private func toggle(_ tag: String) {
        if selectedTags.contains(tag) {
            selectedTags.remove(tag)
        } else {
            selectedTags.insert(tag)
        }
        renderSuggestions()
    }

    @objc private func addCustomTag() {
        let tag = customTagField.text?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !tag.isEmpty else { return }
        selectedTags.insert(tag)
        customTagField.text = ""
    }

    private func save() {
        addCustomTag()
        navigationItem.rightBarButtonItem?.isEnabled = false
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                item = try await application.updateTags(
                    itemID: item.id,
                    tags: Array(selectedTags)
                )
                onSaved?(item)
            } catch {
                navigationItem.rightBarButtonItem?.isEnabled = true
                MemoStyle.showError(error, on: self)
            }
        }
    }
}
