import UIKit

final class MemoRootViewController: UIViewController {
    private let application = MemoApplication()
    private var rootNavigationController = UINavigationController()
    private weak var libraryController: LibraryViewController?
    private var didHandleRequestedScreen = false

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }
    override var prefersStatusBarHidden: Bool { false }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var shouldAutorotate: Bool { false }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = MemoStyle.warmBackground
        installNavigationController(
            rootViewController: MemoLoadingViewController()
        )
        application.onLibraryChanged = { [weak self] items in
            self?.libraryController?.update(items: items)
        }
        Task { @MainActor [weak self] in
            guard let self else { return }
            show(destination: await application.bootstrap(), animated: false)
        }
    }

    private func installNavigationController(
        rootViewController: UIViewController
    ) {
        if rootNavigationController.parent != nil {
            rootNavigationController.willMove(toParent: nil)
            rootNavigationController.view.removeFromSuperview()
            rootNavigationController.removeFromParent()
        }
        rootNavigationController = UINavigationController(
            rootViewController: rootViewController
        )
        MemoStyle.configureNavigationBar(rootNavigationController.navigationBar)
        addChild(rootNavigationController)
        rootNavigationController.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(rootNavigationController.view)
        NSLayoutConstraint.activate([
            rootNavigationController.view.topAnchor.constraint(equalTo: view.topAnchor),
            rootNavigationController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            rootNavigationController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            rootNavigationController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        rootNavigationController.didMove(toParent: self)
    }

    private func show(destination: MemoApplication.Destination, animated: Bool) {
        switch destination {
        case .authentication:
            showAuthentication(animated: animated)
        case .onboarding:
            showOnboarding(animated: animated)
        case .library:
            showLibrary(animated: animated)
        }
    }

    private func showAuthentication(animated: Bool) {
        didHandleRequestedScreen = false
        let controller = AuthIntroViewController()
        controller.onCreateAccount = { [weak self] in
            self?.showAuthForm(mode: .register)
        }
        controller.onLogin = { [weak self] in
            self?.showAuthForm(mode: .login)
        }
        installNavigationController(rootViewController: controller)
    }

    private func showAuthForm(mode: AuthFormViewController.Mode) {
        let controller = AuthFormViewController(mode: mode)
        controller.onSubmit = { [weak self] identifier, password, nickname in
            guard let self else { return }
            let destination: MemoApplication.Destination
            switch mode {
            case .login:
                destination = try await application.login(
                    identifier: identifier,
                    password: password
                )
            case .register:
                destination = try await application.register(
                    nickname: nickname ?? "",
                    identifier: identifier,
                    password: password
                )
            }
            DispatchQueue.main.async { [weak self] in
                self?.show(destination: destination, animated: false)
            }
        }
        rootNavigationController.pushViewController(controller, animated: true)
    }

    private func showOnboarding(animated: Bool) {
        let controller = OnboardingViewController()
        controller.onComplete = { [weak self] in
            guard let self else { return }
            try await application.completeOnboarding()
            showLibrary(animated: true)
        }
        installNavigationController(rootViewController: controller)
    }

    private func showLibrary(animated: Bool) {
        guard let user = application.auth.user else {
            showAuthentication(animated: animated)
            return
        }

        let controller = LibraryViewController(user: user)
        controller.update(items: application.items)
        controller.onAdd = { [weak self] in self?.presentAdd() }
        controller.onSearch = { [weak self] in self?.showSearch() }
        controller.onOpenItem = { [weak self] item in self?.showItem(item) }
        controller.onSettings = { [weak self] in self?.presentSettings() }
        libraryController = controller
        installNavigationController(rootViewController: controller)
        handleRequestedScreenIfNeeded()
    }

    private func handleRequestedScreenIfNeeded() {
        guard !didHandleRequestedScreen else { return }
        didHandleRequestedScreen = true
        switch application.requestedScreenID {
        case "03-add":
            presentAdd()
        case "08-search":
            showSearch()
        case "04-detail-podcast", "06-detail-article":
            if let item = application.items.first {
                showItem(item)
            }
        case "07-processing":
            if let item = application.items.first(where: { $0.status != .ready }) {
                showProcessing(item)
            }
        case "11-edit-tags":
            if let item = application.items.first {
                showTagEditor(item)
            }
        default:
            break
        }
    }

    private func presentAdd() {
        guard presentedViewController == nil else { return }
        let controller = AddContentViewController()
        controller.onSubmit = { [weak self, weak controller] rawURL in
            guard let self else { return }
            let item = try await application.addURL(rawURL)
            controller?.dismiss(animated: true) { [weak self] in
                self?.showProcessing(item)
            }
        }
        let navigation = UINavigationController(rootViewController: controller)
        MemoStyle.configureNavigationBar(navigation.navigationBar)
        navigation.modalPresentationStyle = .fullScreen
        present(navigation, animated: true)
    }

    private func showSearch() {
        let controller = SearchViewController(application: application)
        controller.onOpenItem = { [weak self] item in self?.showItem(item) }
        rootNavigationController.pushViewController(controller, animated: true)
    }

    private func showProcessing(_ item: KnowledgeItem) {
        let controller = ProcessingViewController(
            application: application,
            item: item
        )
        controller.onReady = { [weak self, weak controller] item in
            guard let self, let controller,
                  rootNavigationController.topViewController === controller else {
                return
            }
            let detail = makeDetailController(item)
            var controllers = rootNavigationController.viewControllers
            controllers.removeLast()
            controllers.append(detail)
            rootNavigationController.setViewControllers(controllers, animated: true)
        }
        rootNavigationController.pushViewController(controller, animated: true)
    }

    private func showItem(_ item: KnowledgeItem) {
        if item.status != .ready {
            showProcessing(item)
            return
        }
        rootNavigationController.pushViewController(
            makeDetailController(item),
            animated: true
        )
    }

    private func makeDetailController(_ item: KnowledgeItem) -> DetailViewController {
        let controller = DetailViewController(
            application: application,
            item: item
        )
        controller.onDeleted = { [weak self] in
            self?.rootNavigationController.popToRootViewController(animated: true)
        }
        controller.onEditTags = { [weak self] item in
            self?.showTagEditor(item)
        }
        return controller
    }

    private func showTagEditor(_ item: KnowledgeItem) {
        let controller = TagEditorViewController(
            application: application,
            item: item
        )
        controller.onSaved = { [weak self] _ in
            self?.rootNavigationController.popViewController(animated: true)
        }
        rootNavigationController.pushViewController(controller, animated: true)
    }

    private func presentSettings() {
        guard let user = application.auth.user else { return }
        let controller = MemoSettingsViewController(
            user: user,
            onChangePassword: { [weak self] currentPassword, newPassword in
                try await self?.application.changePassword(
                    currentPassword: currentPassword,
                    newPassword: newPassword
                )
            },
            onDeleteAccount: { [weak self] currentPassword in
                guard let self else { return }
                try await application.deleteAccount(
                    currentPassword: currentPassword
                )
                finishAuthenticationExit()
            },
            onLogout: { [weak self] in
                guard let self else { return }
                await application.logout()
                finishAuthenticationExit()
            }
        )
        let navigation = UINavigationController(rootViewController: controller)
        MemoStyle.configureNavigationBar(navigation.navigationBar)
        navigation.modalPresentationStyle = .fullScreen
        present(navigation, animated: true)
    }

    private func finishAuthenticationExit() {
        dismiss(animated: true) { [weak self] in
            self?.showAuthentication(animated: true)
        }
    }
}
