import UIKit

final class SearchViewController: UIViewController {
    var onOpenItem: ((KnowledgeItem) -> Void)?

    private let libraryService: any LibraryFeatureService
    private let tableView = UITableView(frame: .zero, style: .plain)
    private let emptyLabel = MemoStyle.label(
        text: "输入标题、摘要或 Tag 搜索收藏",
        style: .body,
        color: .secondaryLabel,
        alignment: .center
    )
    private var results: [KnowledgeItem] = []

    init(libraryService: any LibraryFeatureService) {
        self.libraryService = libraryService
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
            results = await libraryService.search(query: query)
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
