import UIKit
import WebKit

final class PrototypeViewController: UIViewController, WKNavigationDelegate {
    private static let validScreenIDs: Set<String> = [
        "01-home",
        "02-home-empty",
        "03-add",
        "04-detail-podcast",
        "05-ai-chat",
        "06-detail-article",
        "07-processing",
        "08-search",
        "09-onboarding",
        "10-unsupported",
        "11-edit-tags",
        "12-ai-empty",
    ]

    private lazy var webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: Self.prototypeBootstrapScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )
        if let runtimeScript = Self.runtimeScript {
            configuration.userContentController.addUserScript(
                WKUserScript(
                    source: runtimeScript,
                    injectionTime: .atDocumentEnd,
                    forMainFrameOnly: true
                )
            )
        }
        configuration.userContentController.addScriptMessageHandler(
            nativeBridge,
            contentWorld: .page,
            name: "nativeBridge"
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.accessibilityIdentifier = "prototype-webview"
        return webView
    }()

    private lazy var nativeBridge = NativeBridge(owner: self)

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var shouldAutorotate: Bool { false }

    private static let prototypeBootstrapScript = """
    (() => {
      const style = document.createElement('style');
      style.id = 'memo-ios-cjk-font-fallback';
      style.textContent = `
        @font-face {
          font-family: 'Memo CJK Sans';
          src: local('PingFang SC');
          unicode-range:
            U+2E80-2FFF, U+3000-303F, U+31C0-31EF, U+3400-4DBF,
            U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF;
        }
        :root {
          --font-body: 'Memo CJK Sans', 'Geist', -apple-system,
            'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
        }
        html, body, button, input, textarea {
          font-family: 'Memo CJK Sans', 'Geist', -apple-system,
            'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
        }
        .screen .phone-frame {
          width: 100vw !important;
          height: 100vh !important;
          transform: none !important;
        }
        #s-06-detail-article .top-nav-bar {
          position: sticky !important;
          top: 0;
          z-index: 30;
          background: linear-gradient(
            to bottom,
            rgba(250, 250, 247, 0.98),
            rgba(250, 250, 247, 0.9)
          );
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
      `;
      document.head.appendChild(style);

      const exposeButton = (selector, label) => {
        const element = document.querySelector(selector);
        if (!element) return;
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', label);
      };

      exposeButton('#s-01-home .topbar-actions .icon-btn', '搜索');
      exposeButton('#s-02-home-empty .top-thin .icon-btn', '设置');
      exposeButton('#s-02-home-empty .empty-cta', '添加第 1 条');
      exposeButton('#s-04-detail-podcast .hero-nav .icon-btn', '返回');
      exposeButton('#s-04-detail-podcast .hero-nav .right .icon-btn:first-child', '分享');
      exposeButton('#s-04-detail-podcast .hero-nav .right .icon-btn:nth-child(2)', '打开原始内容');
      exposeButton('#s-04-detail-podcast .hero-play', '打开原内容播放');
      exposeButton('#s-04-detail-podcast .ask-btn', '基于这篇问 AI');
      exposeButton('#s-04-detail-podcast .action-bar .icon-btn:first-child', '从收藏中移除');
      exposeButton('#s-04-detail-podcast .action-bar .icon-btn:nth-child(2)', '标记为喜欢');
      exposeButton('#s-06-detail-article .nav-pill', '返回');
      exposeButton('#s-06-detail-article .ask-btn', '基于这篇问 AI');
      exposeButton('#s-06-detail-article .nav-actions .nav-btn:first-child', '分享');
      exposeButton('#s-06-detail-article .nav-actions .nav-btn:nth-child(2)', '更多');
      exposeButton('#s-06-detail-article .tag-section .edit', '编辑 Tag');
      exposeButton('#s-06-detail-article .float-actions .float-btn:first-child', '查看引用');
      exposeButton('#s-06-detail-article .float-actions .float-btn:nth-child(2)', '基于这篇问 AI');
      exposeButton('#s-06-detail-article .float-actions .float-btn:nth-child(3)', '删除收藏');
      exposeButton('#s-12-ai-empty .ai-head-r .icon-btn:first-child', '对话历史');
      exposeButton('#s-12-ai-empty .ai-head-r .icon-btn:nth-child(2)', '设置');
      exposeButton('#s-12-ai-empty .side-new', '新对话');
      exposeButton('#s-12-ai-empty .side-close', '关闭对话历史');
      exposeButton('#s-10-unsupported .alert-actions .btn:first-child', '不保留');
      exposeButton('#s-10-unsupported .alert-actions .btn:nth-child(2)', '保留链接');
      exposeButton('#s-11-edit-tags .btn-save', '保存修改');
      exposeButton('#s-11-edit-tags .btn-cancel', '取消编辑');

      const labelInput = (selector, label) => {
        const element = document.querySelector(selector);
        if (element) element.setAttribute('aria-label', label);
      };
      labelInput('#s-03-add .sheet-input', '内容链接');
      labelInput('#s-08-search .search-input input', '搜索收藏');
      labelInput('#s-11-edit-tags .add-tag-input input', '添加新 Tag');
      labelInput('#s-05-ai-chat .ai-input input', '向 Memo AI 提问');
      labelInput('#s-12-ai-empty .composer input', '向知识助手提问');

      document.querySelectorAll('.tab-add').forEach((element) => {
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', '添加');
      });

      document.querySelectorAll('#s-08-search .result-item').forEach((element) => {
        const title = element.querySelector('.title')?.textContent?.trim();
        if (!title) return;
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', title);
      });
    })();
    """

    private static let runtimeScript: String? = {
        guard let url = Bundle.main.url(
            forResource: "AppRuntime",
            withExtension: "js"
        ) else {
            return nil
        }
        return try? String(contentsOf: url, encoding: .utf8)
    }()

    override func loadView() {
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        loadPrototype()
    }

    private func loadPrototype() {
        guard let htmlURL = Bundle.main.url(forResource: "app", withExtension: "html"),
              let resourceURL = Bundle.main.resourceURL else {
            showMissingPrototypeError()
            return
        }

        let requestedScreen = ProcessInfo.processInfo.environment["KNOWLEDGE_SCREEN"]
        let screenID = requestedScreen.flatMap { screenID in
            Self.validScreenIDs.contains(screenID) ? screenID : nil
        } ?? "01-home"

        guard let routedURL = URL(string: "\(htmlURL.absoluteString)#\(screenID)") else {
            showMissingPrototypeError()
            return
        }

        webView.loadFileURL(routedURL, allowingReadAccessTo: resourceURL)
    }

    private func showMissingPrototypeError() {
        let label = UILabel()
        label.text = "无法加载内置原型"
        label.textAlignment = .center
        label.textColor = .label
        label.backgroundColor = .systemBackground
        view = label
    }

    func sendNativeEvent(name: String, payload: Any) {
        guard JSONSerialization.isValidJSONObject([
            "name": name,
            "payload": payload,
        ]),
        let data = try? JSONSerialization.data(
            withJSONObject: ["name": name, "payload": payload]
        ),
        let json = String(data: data, encoding: .utf8) else {
            return
        }
        webView.evaluateJavaScript(
            "window.MemoRuntime?.nativeEvent(\(json));"
        )
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if url.isFileURL || url.scheme == "about" {
            decisionHandler(.allow)
            return
        }

        if navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }
}
