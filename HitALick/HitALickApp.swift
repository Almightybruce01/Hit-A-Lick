






import SwiftUI
import FirebaseCore
import FirebaseAuth
import FirebaseAppCheck
import UserNotifications

/// App Check: Firebase docs require **setting the provider factory before** `FirebaseApp.configure()`.
/// - DEBUG / simulator: debug provider (register token in Firebase Console if needed).
/// - Release on device: App Attest.
private final class HitALickAppCheckFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
        #if DEBUG
        return AppCheckDebugProvider(app: app)
        #else
        #if targetEnvironment(simulator)
        // App Attest is unavailable on simulator; use debug provider for Release simulator builds.
        return AppCheckDebugProvider(app: app)
        #else
        return AppAttestProvider(app: app)
        #endif
        #endif
    }
}

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        AppCheck.setAppCheckProviderFactory(HitALickAppCheckFactory())
        FirebaseApp.configure()

        // ✅ Ask for Push Notification Permission
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in }
        application.registerForRemoteNotifications()

        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Auth.auth().setAPNSToken(deviceToken, type: .unknown)
    }

    func application(_ application: UIApplication,
                     didReceiveRemoteNotification userInfo: [AnyHashable : Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        if Auth.auth().canHandleNotification(userInfo) {
            completionHandler(.noData)
            return
        }
        completionHandler(.newData)
    }

    func application(_ app: UIApplication, open url: URL,
                     options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {
        return Auth.auth().canHandle(url)
    }
}

@main
struct Hit_A_LickApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate

    var body: some Scene {
        WindowGroup {
            SplashView() // ⬅️ This now loads first
        }
    }
}
