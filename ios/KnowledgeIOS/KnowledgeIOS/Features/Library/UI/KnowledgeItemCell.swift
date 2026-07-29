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
            : (isFailed ? "分析未完成，可点击重试" : item.statusText)
        summaryLabel.text = isReady
            ? item.summary
            : (isFailed
                ? failureMessage(for: item)
                : processingDetail(for: item))
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
        progressView.accessibilityValue = "\(Int((item.progress * 100).rounded()))%"
        progressMeta.isHidden = isReady || isFailed
        etaLabel.text = elapsedTime(for: item)
        percentLabel.text = "流程 \(Int((item.progress * 100).rounded()))%"
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

    private func processingDetail(for item: KnowledgeItem) -> String {
        switch item.status {
        case .queued:
            "等待后台开始处理。"
        case .fetching:
            "正在识别内容类型并读取原始素材。"
        case .extracting:
            "正在根据后台已完成步骤更新进度。"
        case .enriching:
            "正在整理摘要、核心要点和标签。"
        case .ready:
            "内容已经整理完成。"
        case .failed:
            "处理没有完成，请点击重试。"
        }
    }

    private func failureMessage(for item: KnowledgeItem) -> String {
        let message = item.errorMessage ?? ""
        if message.localizedCaseInsensitiveContains("No video formats found")
            || message.localizedCaseInsensitiveContains("[XiaoHongShu]") {
            return "暂时无法读取这条小红书内容。刷新分享链接后点击卡片重试。"
        }
        if message.isEmpty {
            return "内容分析没有完成，点击卡片重试。"
        }
        return message
    }

    private func elapsedTime(for item: KnowledgeItem) -> String {
        guard let startedAt = item.processingStartedAt else {
            return item.status == .queued ? "等待后台开始" : "后台处理中"
        }
        let elapsed = max(0, Int(Date().timeIntervalSince(startedAt)))
        let minutes = elapsed / 60
        let seconds = elapsed % 60
        return minutes > 0
            ? "已用时 \(minutes)分\(seconds)秒"
            : "已用时 \(seconds)秒"
    }
}
