import Foundation

class StatsViewModel: ObservableObject {
    @Published var entities: [EntityStat] = []

    func loadStats(for sport: String, mode: String) {
        APIServices.shared.fetchEntityStats(for: sport, mode: mode) { [weak self] rows in
            DispatchQueue.main.async {
                self?.entities = rows
                print("✅ Loaded \(rows.count) entities from API")
            }
        }
    }
}
