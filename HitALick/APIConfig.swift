import Foundation

/// Single place to configure API origin (prod vs staging). Override in **Debug** Account settings, or UserDefaults:
/// `UserDefaults.standard.set("https://your-cloud-run-url", forKey: APIConfig.baseURLKey)`
enum APIConfig {
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
}
