import UIKit

final class MemoRootViewController: UIViewController {
    private let application: MemoApplication
    private var rootNavigationController = UINavigationController()
    private weak var libraryController: LibraryViewController?
    private var didHandleRequestedScreen = false

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }
    override var prefersStatusBarHidden: Bool { false }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var shouldAutorotate: Bool { false }

    init(application: MemoApplication) {
        self.application = application
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

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
        controller.onContinue = { [weak self] in
            self?.showAuthForm(mode: .login)
        }
        installNavigationController(rootViewController: controller)
    }

    private func showAuthForm(mode: AuthFormViewController.Mode) {
        let controller = makeAuthForm(mode: mode)
        rootNavigationController.pushViewController(controller, animated: true)
    }

    private func replaceAuthForm(mode: AuthFormViewController.Mode) {
        let controller = makeAuthForm(mode: mode)
        var controllers = rootNavigationController.viewControllers
        if controllers.isEmpty {
            controllers = [controller]
        } else {
            controllers[controllers.count - 1] = controller
        }
        rootNavigationController.setViewControllers(controllers, animated: true)
    }

    private func makeAuthForm(
        mode: AuthFormViewController.Mode
    ) -> AuthFormViewController {
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
        controller.onSwitchMode = { [weak self] nextMode in
            self?.replaceAuthForm(mode: nextMode)
        }
        return controller
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
            break
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
            _ = try await application.addURL(rawURL)
            controller?.dismiss(animated: true)
        }
        let navigation = UINavigationController(rootViewController: controller)
        MemoStyle.configureNavigationBar(navigation.navigationBar)
        navigation.modalPresentationStyle = .pageSheet
        if let sheet = navigation.sheetPresentationController {
            sheet.detents = [.medium()]
            sheet.selectedDetentIdentifier = .medium
            sheet.prefersGrabberVisible = true
            sheet.prefersScrollingExpandsWhenScrolledToEdge = false
            sheet.preferredCornerRadius = 28
        }
        present(navigation, animated: true)
    }

    private func showSearch() {
        let controller = SearchViewController(libraryService: application)
        controller.onOpenItem = { [weak self] item in self?.showItem(item) }
        rootNavigationController.pushViewController(controller, animated: true)
    }

    private func showItem(_ item: KnowledgeItem) {
        guard item.status == .ready else {
            if item.status == .failed {
                Task { @MainActor [weak self] in
                    _ = try? await self?.application.retry(itemID: item.id)
                }
            }
            return
        }
        rootNavigationController.pushViewController(
            makeDetailController(item),
            animated: true
        )
    }

    private func makeDetailController(_ item: KnowledgeItem) -> DetailViewController {
        let controller = DetailViewController(
            libraryService: application,
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
            libraryService: application,
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
