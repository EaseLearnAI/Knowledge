import UIKit

@MainActor
final class AppCompositionRoot {
    private let application: MemoApplication

    init(application: MemoApplication = MemoApplication()) {
        self.application = application
    }

    func makeRootViewController() -> UIViewController {
        MemoRootViewController(application: application)
    }
}
