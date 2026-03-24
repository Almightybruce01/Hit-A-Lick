import Foundation

class PlayerViewModel: ObservableObject {
    @Published var players: [Player] = []

    func loadPlayers(for sport: String) {
        APIServices.shared.fetchPlayers(for: sport) { [weak self] players in
            DispatchQueue.main.async {
                self?.players = players
            }
        }
    }
}
