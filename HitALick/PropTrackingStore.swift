import Foundation
import Combine

/// Persists tracked game ids locally until you wire Firestore watchlists.
final class PropTrackingStore: ObservableObject {
    static let shared = PropTrackingStore()

    @Published private(set) var ids: Set<String> = []

    private let key = "hitalick_tracked_prop_ids"

    private init() {
        load()
    }

    private func load() {
        if let arr = UserDefaults.standard.array(forKey: key) as? [String] {
            ids = Set(arr)
        }
    }

    private func save() {
        UserDefaults.standard.set(Array(ids), forKey: key)
    }

    func contains(_ id: String) -> Bool {
        ids.contains(id)
    }

    func toggle(_ id: String) {
        if ids.contains(id) {
            ids.remove(id)
        } else {
            ids.insert(id)
        }
        save()
    }
}
