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
        progressView.progress = stageProgress(for: item.status)
        progressMeta.isHidden = isReady || isFailed
        etaLabel.text = processingTimeHint(for: item.status)
        percentLabel.text = stageLabel(for: item.status)
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

    private func processingTimeHint(for status: KnowledgeItemStatus) -> String {
        switch status {
        case .queued, .fetching, .extracting, .enriching:
            "耗时取决于原内容长度"
        case .ready:
            "已完成"
        case .failed:
            ""
        }
    }

    private func stageLabel(for status: KnowledgeItemStatus) -> String {
        switch status {
        case .queued:
            "等待开始"
        case .fetching:
            "第 1/3 步"
        case .extracting:
            "第 2/3 步"
        case .enriching:
            "第 3/3 步"
        case .ready:
            "已完成"
        case .failed:
            ""
        }
    }

    private func stageProgress(for status: KnowledgeItemStatus) -> Float {
        switch status {
        case .queued:
            0.05
        case .fetching:
            0.25
        case .extracting:
            0.55
        case .enriching:
            0.85
        case .ready:
            1
        case .failed:
            0
        }
    }
}
