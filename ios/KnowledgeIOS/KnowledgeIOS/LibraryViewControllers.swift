import UIKit

final class KnowledgeItemCell: UITableViewCell {
    static let reuseIdentifier = "KnowledgeItemCell"

    private let cardView = UIView()
    private let sourceLabel = MemoStyle.label(
        style: .caption1,
        color: .secondaryLabel,
        lines: 1
    )
    private let titleLabel = MemoStyle.label(style: .headline, lines: 2)
    private let summaryLabel = MemoStyle.label(
        style: .subheadline,
        color: .secondaryLabel,
        lines: 2
    )
    private let tagsStack = UIStackView()
    private let progressView = UIProgressView(progressViewStyle: .default)
    private let etaLabel = MemoStyle.label(
        style: .caption1,
        color: .secondaryLabel,
        lines: 1
    )
    private let percentLabel = MemoStyle.label(
        style: .caption1,
        color: MemoStyle.orange,
        alignment: .right,
        lines: 1
    )
    private let progressMeta = UIStackView()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        contentView.backgroundColor = .clear
        selectionStyle = .none

        cardView.backgroundColor = .secondarySystemBackground
        cardView.layer.cornerRadius = 20
        cardView.layer.cornerCurve = .continuous
        cardView.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(cardView)

        tagsStack.axis = .horizontal
        tagsStack.alignment = .center
        tagsStack.spacing = 6

        progressView.progressTintColor = MemoStyle.orange
        progressView.trackTintColor = .tertiarySystemFill
        progressView.layer.cornerRadius = 3
        progressView.clipsToBounds = true
        progressView.transform = CGAffineTransform(scaleX: 1, y: 1.7)

        progressMeta.axis = .horizontal
        progressMeta.alignment = .center
        progressMeta.addArrangedSubview(etaLabel)
        progressMeta.addArrangedSubview(percentLabel)

        let stack = UIStackView(
            arrangedSubviews: [
                sourceLabel,
                titleLabel,
                summaryLabel,
                tagsStack,
                progressView,
                progressMeta,
            ]
        )
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        cardView.addSubview(stack)
        NSLayoutConstraint.activate([
            cardView.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 6),
            cardView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            cardView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            cardView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -6),

            stack.topAnchor.constraint(equalTo: cardView.topAnchor, constant: 18),
            stack.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -18),
            stack.bottomAnchor.constraint(equalTo: cardView.bottomAnchor, constant: -18),
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func configure(item: KnowledgeItem) {
        let isReady = item.status == .ready
        let isFailed = item.status == .failed
        sourceLabel.text = isReady
            ? item.sourceName
            : "\(platformName(for: item)) · \(isFailed ? "分析失败" : "分析中")"
        titleLabel.text = isReady
            ? item.title
            : (isFailed ? "这条内容没有分析完成" : item.statusText)
        summaryLabel.text = isReady
            ? item.summary
            : (isFailed
                ? item.errorMessage ?? "点击卡片重试"
                : processingDetail(for: item.status))
        tagsStack.arrangedSubviews.forEach {
            tagsStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        item.tags.prefix(3).forEach {
            tagsStack.addArrangedSubview(MemoStyle.tagPill($0))
        }
        tagsStack.isHidden = !isReady || item.tags.isEmpty
        progressView.isHidden = isReady || isFailed
        progressView.progress = Float(item.progress)
        progressMeta.isHidden = isReady || isFailed
        etaLabel.text = estimatedTime(for: item.status)
        percentLabel.text = "\(Int((item.progress * 100).rounded()))%"
        cardView.backgroundColor = isFailed
            ? UIColor.systemRed.withAlphaComponent(0.07)
            : .secondarySystemBackground
        accessibilityLabel = [
            sourceLabel.text ?? "",
            titleLabel.text ?? "",
            summaryLabel.text ?? "",
            item.tags.joined(separator: "、"),
            progressMeta.isHidden ? "" : etaLabel.text ?? "",
            progressMeta.isHidden ? "" : percentLabel.text ?? "",
        ]
        .filter { !$0.isEmpty }
        .joined(separator: "，")
        accessibilityIdentifier = isReady
            ? item.title
            : (isFailed ? "分析失败卡片" : "分析中卡片")
    }

    private func platformName(for item: KnowledgeItem) -> String {
        let host = item.sourceURL.host()?.lowercased() ?? item.sourceName.lowercased()
        if host.contains("xiaohongshu") || host.contains("xhslink") {
            return "小红书"
        }
        if host.contains("douyin") {
            return "抖音"
        }
        if host.contains("bilibili") || host.contains("b23") {
            return "B站"
        }
        return item.sourceName
    }

    private func processingDetail(for status: KnowledgeItemStatus) -> String {
        switch status {
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
            "处理没有完成，请点击重试。"
        }
    }

    private func estimatedTime(for status: KnowledgeItemStatus) -> String {
        switch status {
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
}

final class LibraryViewController: UIViewController {
    var onAdd: (() -> Void)?
    var onSearch: (() -> Void)?
    var onOpenItem: ((KnowledgeItem) -> Void)?
    var onSettings: (() -> Void)?

    private let user: AuthUser
    private let tableView = UITableView(frame: .zero, style: .plain)
    private let emptyView = UIStackView()
    private let addButton = UIButton(type: .system)
    private var items: [KnowledgeItem] = []

    init(user: AuthUser) {
        self.user = user
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Memo"
        view.backgroundColor = MemoStyle.warmBackground
        configureNavigation()
        configureTable()
        configureEmptyView()
        configureAddButton()
    }

    func update(items: [KnowledgeItem]) {
        self.items = items
        tableView.reloadData()
        emptyView.isHidden = !items.isEmpty
        tableView.isHidden = items.isEmpty
    }

    private func configureNavigation() {
        navigationItem.leftBarButtonItem = MemoStyle.iconBarButton(
            symbol: "line.3.horizontal",
            label: "侧边栏",
            target: self,
            action: #selector(openDrawer)
        )
        navigationItem.rightBarButtonItem = MemoStyle.iconBarButton(
            symbol: "magnifyingglass",
            label: "搜索",
            target: self,
            action: #selector(searchTapped)
        )
    }

    private func configureTable() {
        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.backgroundColor = .clear
        tableView.separatorStyle = .none
        tableView.contentInset = UIEdgeInsets(
            top: 12,
            left: 0,
            bottom: 104,
            right: 0
        )
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 148
        tableView.delegate = self
        tableView.dataSource = self
        tableView.register(
            KnowledgeItemCell.self,
            forCellReuseIdentifier: KnowledgeItemCell.reuseIdentifier
        )
        view.addSubview(tableView)
        NSLayoutConstraint.activate([
            tableView.topAnchor.constraint(equalTo: view.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    private func configureEmptyView() {
        let symbol = UIImageView(
            image: UIImage(
                systemName: "rectangle.stack.badge.plus",
                withConfiguration: UIImage.SymbolConfiguration(
                    pointSize: 74,
                    weight: .regular
                )
            )
        )
        symbol.tintColor = MemoStyle.orange
        symbol.contentMode = .scaleAspectFit
        symbol.heightAnchor.constraint(equalToConstant: 96).isActive = true

        let title = MemoStyle.label(
            text: "收藏进来，真正用起来",
            style: .largeTitle,
            alignment: .center
        )
        title.font = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(
            for: .systemFont(ofSize: 31, weight: .bold)
        )

        let body = MemoStyle.label(
            text: "粘贴分享文案或链接，Memo 自动识别链接、提取内容并生成摘要和 Tag。",
            style: .body,
            color: .secondaryLabel,
            alignment: .center
        )

        let first = MemoStyle.primaryButton(title: "添加第 1 条")
        first.addTarget(self, action: #selector(addTapped), for: .touchUpInside)

        emptyView.axis = .vertical
        emptyView.spacing = 22
        emptyView.alignment = .fill
        emptyView.addArrangedSubview(symbol)
        emptyView.addArrangedSubview(title)
        emptyView.addArrangedSubview(body)
        emptyView.addArrangedSubview(first)
        emptyView.setCustomSpacing(34, after: symbol)
        emptyView.setCustomSpacing(12, after: title)
        emptyView.setCustomSpacing(30, after: body)
        emptyView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(emptyView)

        NSLayoutConstraint.activate([
            emptyView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 34),
            emptyView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -34),
            emptyView.centerYAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.centerYAnchor,
                constant: -34
            ),
        ])
    }

    private func configureAddButton() {
        var configuration = UIButton.Configuration.filled()
        configuration.image = UIImage(
            systemName: "plus",
            withConfiguration: UIImage.SymbolConfiguration(
                pointSize: 25,
                weight: .medium
            )
        )
        configuration.baseBackgroundColor = .label
        configuration.baseForegroundColor = .systemBackground
        configuration.cornerStyle = .capsule
        addButton.configuration = configuration
        addButton.accessibilityLabel = "添加"
        addButton.accessibilityIdentifier = "添加"
        addButton.layer.shadowColor = UIColor.black.cgColor
        addButton.layer.shadowOpacity = 0.18
        addButton.layer.shadowRadius = 18
        addButton.layer.shadowOffset = CGSize(width: 0, height: 8)
        addButton.translatesAutoresizingMaskIntoConstraints = false
        addButton.addTarget(self, action: #selector(addTapped), for: .touchUpInside)
        view.addSubview(addButton)

        NSLayoutConstraint.activate([
            addButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            addButton.bottomAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.bottomAnchor,
                constant: -20
            ),
            addButton.widthAnchor.constraint(equalToConstant: 64),
            addButton.heightAnchor.constraint(equalToConstant: 64),
        ])
    }

    @objc private func openDrawer() {
        let drawer = MemoDrawerViewController(user: user)
        drawer.onSettings = onSettings
        present(drawer, animated: true)
    }

    @objc private func searchTapped() {
        onSearch?()
    }

    @objc private func addTapped() {
        onAdd?()
    }
}

extension LibraryViewController: UITableViewDataSource, UITableViewDelegate {
    func tableView(
        _ tableView: UITableView,
        numberOfRowsInSection section: Int
    ) -> Int {
        items.count
    }

    func tableView(
        _ tableView: UITableView,
        cellForRowAt indexPath: IndexPath
    ) -> UITableViewCell {
        guard let cell = tableView.dequeueReusableCell(
            withIdentifier: KnowledgeItemCell.reuseIdentifier,
            for: indexPath
        ) as? KnowledgeItemCell else {
            return UITableViewCell()
        }
        cell.configure(item: items[indexPath.row])
        return cell
    }

    func tableView(
        _ tableView: UITableView,
        didSelectRowAt indexPath: IndexPath
    ) {
        tableView.deselectRow(at: indexPath, animated: true)
        onOpenItem?(items[indexPath.row])
    }

}

final class SearchViewController: UIViewController {
    var onOpenItem: ((KnowledgeItem) -> Void)?

    private let application: MemoApplication
    private let tableView = UITableView(frame: .zero, style: .plain)
    private let emptyLabel = MemoStyle.label(
        text: "输入标题、摘要或 Tag 搜索收藏",
        style: .body,
        color: .secondaryLabel,
        alignment: .center
    )
    private var results: [KnowledgeItem] = []

    init(application: MemoApplication) {
        self.application = application
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "搜索"
        view.backgroundColor = MemoStyle.warmBackground

        let search = UISearchController(searchResultsController: nil)
        search.obscuresBackgroundDuringPresentation = false
        search.searchResultsUpdater = self
        search.searchBar.placeholder = "搜索收藏"
        search.searchBar.searchTextField.accessibilityIdentifier = "搜索收藏"
        navigationItem.searchController = search
        navigationItem.hidesSearchBarWhenScrolling = false
        definesPresentationContext = true

        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.backgroundColor = .clear
        tableView.separatorStyle = .none
        tableView.contentInset = UIEdgeInsets(top: 12, left: 16, bottom: 24, right: 16)
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 148
        tableView.delegate = self
        tableView.dataSource = self
        tableView.register(
            KnowledgeItemCell.self,
            forCellReuseIdentifier: KnowledgeItemCell.reuseIdentifier
        )
        view.addSubview(tableView)

        emptyLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(emptyLabel)
        NSLayoutConstraint.activate([
            tableView.topAnchor.constraint(equalTo: view.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            emptyLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            emptyLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            emptyLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            emptyLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        navigationItem.searchController?.isActive = true
        navigationItem.searchController?.searchBar.searchTextField.becomeFirstResponder()
    }
}

extension SearchViewController: UISearchResultsUpdating {
    func updateSearchResults(for searchController: UISearchController) {
        let query = searchController.searchBar.text ?? ""
        Task { @MainActor [weak self] in
            guard let self else { return }
            results = await application.search(query: query)
            tableView.reloadData()
            emptyLabel.text = query.isEmpty
                ? "输入标题、摘要或 Tag 搜索收藏"
                : "没有找到相关收藏"
            emptyLabel.isHidden = !results.isEmpty
        }
    }
}

extension SearchViewController: UITableViewDataSource, UITableViewDelegate {
    func tableView(
        _ tableView: UITableView,
        numberOfRowsInSection section: Int
    ) -> Int {
        results.count
    }

    func tableView(
        _ tableView: UITableView,
        cellForRowAt indexPath: IndexPath
    ) -> UITableViewCell {
        guard let cell = tableView.dequeueReusableCell(
            withIdentifier: KnowledgeItemCell.reuseIdentifier,
            for: indexPath
        ) as? KnowledgeItemCell else {
            return UITableViewCell()
        }
        cell.configure(item: results[indexPath.row])
        return cell
    }

    func tableView(
        _ tableView: UITableView,
        didSelectRowAt indexPath: IndexPath
    ) {
        tableView.deselectRow(at: indexPath, animated: true)
        onOpenItem?(results[indexPath.row])
    }
}
