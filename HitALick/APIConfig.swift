import Foundation

/// Single place to configure API origin (prod vs staging). Override in **Debug** Account settings, or UserDefaults:
/// `UserDefaults.standard.set("https://your-cloud-run-url", forKey: APIConfig.baseURLKey)`
enum APIConfig {
    /// Website where Stripe checkout runs (Firebase Hosting — same `/api` rewrite as production).
    /// Mirror: `https://almightybruce01.github.io/Hit-A-Lick` (checkout uses Cloud Run directly on github.io).
    static let websiteOrigin = "https://hit-a-lick-database.web.app"

    /// Website-only subscriptions (App Store compliance — no IAP for membership). Always open in Safari/in-app browser.
    static var membershipPurchaseURL: URL {
        URL(string: "\(websiteOrigin)/pricing.html")!
    }

    /// Sign in on the web before checkout (shared session keys with Safari if user completes flow there).
    static var membershipAccountURL: URL {
        URL(string: "\(websiteOrigin)/account.html")!
    }

    static let baseURLKey = "hitalick_api_base"

    /// Production Cloud Run URL for the `api` HTTPS function.
    static let productionBaseURL = "https://api-lifnvql5aa-uc.a.run.app"

    static var baseURL: String {
        let raw = (UserDefaults.standard.string(forKey: baseURLKey) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, URL(string: raw)?.host != nil else {
            return productionBaseURL
        }
        return raw.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    /// Clears override so `baseURL` uses production.
    static func clearBaseURLOverride() {
        UserDefaults.standard.removeObject(forKey: baseURLKey)
    }

    /// Sets a staging API origin, or `nil` / empty to clear.
    static func setBaseURLOverride(_ raw: String?) {
        let t = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if t.isEmpty {
            clearBaseURLOverride()
        } else {
            UserDefaults.standard.set(t, forKey: baseURLKey)
        }
    }

    private static let deviceIdKey = "hitalick_device_id_v1"

    /// Stable id sent as `X-Hit-Device-Id` for concurrent-device limits (matches web `localStorage` key name pattern).
    static var clientDeviceId: String {
        if let s = UserDefaults.standard.string(forKey: deviceIdKey) {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.count >= 12 { return t }
        }
        let u = UUID().uuidString
        UserDefaults.standard.set(u, forKey: deviceIdKey)
        return u
    }
}

extension URLRequest {
    mutating func hitApplySessionHeaders(firebaseIdToken token: String) {
        setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        setValue(APIConfig.clientDeviceId, forHTTPHeaderField: "X-Hit-Device-Id")
    }
}
