import SwiftUI

struct Games: View {
    @State private var selectedSport: String = "ALL"
    @State private var searchText: String = ""
    @State private var games: [Game] = []
    @State private var isLoading = true
    @State private var minOddsOnly = false

    let sports = ["ALL", "NBA", "NFL", "MLB", "WNBA"]

    var filteredGames: [Game] {
        let searchLower = searchText.lowercased()
        let searchFilteredGames = games.filter { game in
            searchText.isEmpty ||
            game.homeTeam.lowercased().contains(searchLower) ||
            game.awayTeam.lowercased().contains(searchLower)
        }

        return searchFilteredGames
    }

    var body: some View {
        ZStack {
            EliteBackground()

            VStack(spacing: 12) {
                HStack {
                    Menu {
                        ForEach(sports, id: \.self) { sport in
                            Button(sport) {
                                selectedSport = sport
                                fetchGames()
                            }
                        }
                    } label: {
                        HStack {
                            Text(selectedSport)
                            Image(systemName: "chevron.down")
                        }
                        .foregroundColor(.white)
                    }

                    Spacer()

                    TextField("Search teams...", text: $searchText)
                        .padding(8)
                        .background(Color.white.opacity(0.1))
                        .cornerRadius(8)
                        .foregroundColor(.white)
                        .frame(width: 140)
                }
                .padding(.horizontal)

                Toggle(isOn: $minOddsOnly) {
                    Text("Show Minus Odds Only")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.8))
                }
                .tint(.cyan)
                .padding(.horizontal)

                ScrollView {
                    if isLoading {
                        VStack(spacing: 12) {
                            SkeletonBlock()
                            SkeletonBlock()
                            SkeletonBlock()
                        }
                        .padding(.horizontal)
                    } else {
                        if filteredGames.isEmpty {
                            EmptyStateCard(
                                title: "No Games Found",
                                message: "No games match the current sport and search filters."
                            )
                            .padding(.horizontal)
                        } else {
                            VStack(spacing: 16) {
                                ForEach(filteredGames) { game in
                                    gameCard(for: game)
                                        .transition(.move(edge: .bottom).combined(with: .opacity))
                                }
                            }
                            .animation(.easeInOut(duration: 0.2), value: filteredGames.count)
                            .padding(.bottom, 20)
                        }
                    }
                }
            }
        }
        .onAppear {
            fetchGames()
        }
        .onChange(of: minOddsOnly) { _ in
            fetchGames()
        }
        .screenEntrance()
    }

    private func gameCard(for game: Game) -> some View {
        let oddsValue = Int(game.odds.replacingOccurrences(of: "+", with: "")) ?? 0
        return ElitePanel {
            VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\(game.awayTeam) @ \(game.homeTeam)")
                    .font(.headline)
                    .foregroundColor(.white)

                Spacer()

                Text(game.time)
                    .font(.caption)
                    .foregroundColor(.gray)
            }

                VStack(alignment: .leading, spacing: 6) {
                    Text("PLAYER PANEL")
                        .font(.caption2)
                        .foregroundColor(.blue.opacity(0.9))
                    Text("Away side: \(game.awayTeam)")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.92))
                    Text("Home side: \(game.homeTeam)")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.92))
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.black.opacity(0.28))
                .cornerRadius(10)

                VStack(alignment: .leading, spacing: 6) {
                    Text("GAME PANEL")
                        .font(.caption2)
                        .foregroundColor(.blue.opacity(0.9))
                    Text("Date: \(game.date)")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.92))
                    Text("Time: \(game.time)")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.92))
                    Text("Venue: \(game.venue)")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.92))
                    if let status = game.status {
                        Text("Status: \(status)")
                            .font(.caption)
                            .foregroundColor(.cyan.opacity(0.9))
                    }
                    if let scoreline = game.scoreline {
                        Text("Scoreline: \(scoreline)")
                            .font(.caption)
                            .foregroundColor(.green.opacity(0.9))
                    }
                    if let clock = game.clock, let period = game.period {
                        Text("Clock: \(clock) • Period: \(period)")
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.85))
                    }
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.black.opacity(0.28))
                .cornerRadius(10)

                VStack(alignment: .leading, spacing: 6) {
                    Text("PROP PANEL")
                        .font(.caption2)
                        .foregroundColor(.blue.opacity(0.9))
                    Text("Primary line: \(game.odds)")
                        .font(.caption)
                        .foregroundColor(.green.opacity(0.95))
                    Text("Market status: pregame board")
                        .font(.caption2)
                        .foregroundColor(.white.opacity(0.78))
                    if let possession = game.possession, !possession.isEmpty {
                        Text("Possession: \(possession)")
                            .font(.caption2)
                            .foregroundColor(.orange.opacity(0.9))
                    }
                    if let baseState = game.baseState, !baseState.isEmpty {
                        Text("Bases: \(baseState)")
                            .font(.caption2)
                            .foregroundColor(.yellow.opacity(0.9))
                    }
                    if game.redZone == true {
                        Text("Red Zone: YES")
                            .font(.caption2.weight(.bold))
                            .foregroundColor(.red.opacity(0.92))
                    }
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.black.opacity(0.28))
                .cornerRadius(10)

                SparklineChart(values: [Double(oddsValue - 20), Double(oddsValue - 6), Double(oddsValue), Double(oddsValue + 8), Double(oddsValue + 4)])
                BarStripChart(values: [Double(oddsValue - 20), Double(oddsValue - 6), Double(oddsValue), Double(oddsValue + 8), Double(oddsValue + 4), Double(oddsValue + 11)])

                HStack {
                    Text("Sportbook line:")
                        .font(.caption2)
                        .foregroundColor(.white.opacity(0.7))
                    Spacer()
                    Text(game.odds)
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.green)
                }
                .padding(.top, 2)
        }
        }
        .padding(.horizontal)
    }

    private func fetchGames() {
        isLoading = true
        APIServices.shared.fetchGames(for: selectedSport) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let data):
                    let filtered = minOddsOnly ? data.filter { ($0.odds.first == "-") } : data
                    self.games = filtered.sorted { lhs, rhs in
                        let l = "\(lhs.date) \(lhs.time)"
                        let r = "\(rhs.date) \(rhs.time)"
                        return l < r
                    }
                case .failure(let error):
                    print("❌ Error: \(error.localizedDescription)")
                    self.games = []
                }
                self.isLoading = false
            }
        }
    }

}
