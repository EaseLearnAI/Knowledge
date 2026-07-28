import UIKit

final class TagEditorViewController: UIViewController {
    var onSaved: ((KnowledgeItem) -> Void)?

    private let libraryService: any LibraryFeatureService
    private var item: KnowledgeItem
    private var selectedTags: Set<String>
    private let customTagField = UITextField()
    private let tagStack = UIStackView()
    private let suggestions = ["产品", "学习", "灵感", "工作", "生活"]

    init(libraryService: any LibraryFeatureService, item: KnowledgeItem) {
        self.libraryService = libraryService
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
                item = try await libraryService.updateTags(
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
