import UIKit

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
