import SwiftUI

struct PlayerHub: View {
    @State private var selectedSport = "ALL"
    @State private var searchText = ""
    @State private var players: [EntityStat] = []
    @State private var isLoading = true
    @State private var venueFilter = "All"

    private let sports = ["ALL", "NBA", "NFL", "MLB", "WNBA"]
    private let venueFilters = ["All", "Home", "Away"]

    private var filteredPlayers: [EntityStat] {
        let venueFiltered = players.filter { row in
            switch venueFilter {
            case "Home":
                return row.statHistory.contains { ($0.venue ?? "").lowercased() == "home" }
            case "Away":
                return row.statHistory.contains { ($0.venue ?? "").lowercased() == "away" }
            default:
                return true
            }
        }
        if searchText.isEmpty { return venueFiltered }
        return venueFiltered.filter { $0.name.lowercased().contains(searchText.lowercased()) }
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
                                fetchPlayers()
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

                    TextField("Search players...", text: $searchText)
                        .padding(8)
                        .background(Color.white.opacity(0.1))
                        .cornerRadius(8)
                        .foregroundColor(.white)
                        .frame(width: 170)
                }
                .padding(.horizontal)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(venueFilters, id: \.self) { item in
                            Button {
                                venueFilter = item
                            } label: {
                                Text(item)
                                    .font(.caption.weight(.semibold))
                                    .foregroundColor(venueFilter == item ? .black : .white)
                                    .padding(.vertical, 6)
                                    .padding(.horizontal, 10)
                                    .background(venueFilter == item ? Color.cyan : Color.white.opacity(0.14))
                                    .cornerRadius(999)
                            }
                        }
                    }
                    .padding(.horizontal)
                }

                ScrollView {
                    if isLoading {
                        VStack(spacing: 12) {
                            SkeletonBlock()
                            SkeletonBlock()
                            SkeletonBlock()
                        }
                        .padding(.horizontal)
                    } else {
                        if filteredPlayers.isEmpty {
                            EmptyStateCard(
                                title: "No Players Found",
                                message: "No players match the current sport and search text."
                            )
                            .padding(.horizontal)
                        } else {
                            VStack(spacing: 12) {
                                ForEach(filteredPlayers) { player in
                                    NavigationLink(destination: PlayerDetailView(player: player)) {
                                        playerCard(player)
                                            .transition(.move(edge: .bottom).combined(with: .opacity))
                                    }
                                }
                            }
                            .animation(.easeInOut(duration: 0.2), value: filteredPlayers.count)
                            .padding(.bottom, 24)
                        }
                    }
                }
            }
        }
        .onAppear(perform: fetchPlayers)
        .screenEntrance()
    }

    @ViewBuilder
    private func playerCard(_ player: EntityStat) -> some View {
        ElitePanel {
            HStack(alignment: .top, spacing: 10) {
                if let headshot = player.headshot, let url = URL(string: headshot), UIApplication.shared.canOpenURL(url) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().aspectRatio(contentMode: .fill)
                        case .failure, .empty:
                            EliteGreyMediaSlot(size: 54, cornerFraction: 0.5)
                        @unknown default:
                            EliteGreyMediaSlot(size: 54, cornerFraction: 0.5)
                        }
                    }
                    .frame(width: 54, height: 54)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(Color.white.opacity(0.14), lineWidth: 1))
                } else {
                    EliteGreyMediaSlot(size: 54, cornerFraction: 0.5)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(Color.white.opacity(0.14), lineWidth: 1))
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(player.name)
                        .font(.headline)
                        .foregroundColor(.white)
                    Text("\(player.team ?? "-") • Position \(player.position ?? "-")")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.75))
                    Text("Stat samples: \(player.statHistory.count)")
                        .font(.caption2)
                        .foregroundColor(.green.opacity(0.9))
                    HStack(spacing: 6) {
                        MetricChip(title: "Pts", value: player.summary?.averages?.points.map { String(format: "%.1f", $0) } ?? "N/A", isPositive: true)
                        MetricChip(title: "Ast", value: player.summary?.averages?.assists.map { String(format: "%.1f", $0) } ?? "N/A", isPositive: true)
                        MetricChip(title: "Min", value: player.summary?.averages?.minutes.map { String(format: "%.1f", $0) } ?? "N/A", isPositive: true)
                    }
                    SparklineChart(values: player.statHistory.compactMap { $0.points.map(Double.init) })
                    BarStripChart(values: player.statHistory.compactMap { $0.points.map(Double.init) })
                }
                Spacer()
            }
        }
        .padding(.horizontal)
        .buttonStyle(PlainButtonStyle())
    }

    private func fetchPlayers() {
        isLoading = true
        APIServices.shared.fetchEntityStats(for: selectedSport, mode: "player") { rows in
            DispatchQueue.main.async {
                self.players = rows
                self.isLoading = false
            }
        }
    }
}

struct PlayerDetailView: View {
    let player: EntityStat

    var body: some View {
        ZStack {
            EliteBackground()
            ScrollView {
                VStack(spacing: 12) {
                    ElitePanel {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(player.name)
                                .font(.title3.bold())
                                .foregroundColor(.white)
                            Text("Position: \(player.position ?? "-")")
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.78))
                            Text("Team: \(player.team ?? "-")")
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.78))
                        }
                    }
                    .padding(.horizontal)

                    ElitePanel {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("PLAYER PANEL")
                                .font(.caption2)
                                .foregroundColor(.blue.opacity(0.9))
                            Text("Recent sample size: \(player.statHistory.count)")
                                .font(.caption)
                                .foregroundColor(.white)
                            Text("Avg points: \(average("points")) • Avg assists: \(average("assists")) • Avg rebounds: \(average("rebounds"))")
                                .font(.caption)
                                .foregroundColor(.green.opacity(0.95))
                            SparklineChart(values: player.statHistory.compactMap { $0.points.map(Double.init) })
                            BarStripChart(values: player.statHistory.compactMap { $0.rebounds.map(Double.init) })
                        }
                    }
                    .padding(.horizontal)

                    ElitePanel {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("GAME PANEL")
                                .font(.caption2)
                                .foregroundColor(.blue.opacity(0.9))
                            ForEach(player.statHistory.prefix(10)) { game in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(game.date) vs \(game.opponent) • \(game.result)")
                                        .font(.caption)
                                        .foregroundColor(.white)
                                    Text("PTS \(game.points ?? 0) • AST \(game.assists ?? 0) • REB \(game.rebounds ?? 0)")
                                        .font(.caption2)
                                        .foregroundColor(.white.opacity(0.78))
                                }
                                .padding(.vertical, 3)
                            }
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
        }
        .navigationTitle("Player Detail")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func average(_ key: String) -> String {
        let values: [Double] = player.statHistory.compactMap { game in
            switch key {
            case "assists":
                return game.assists.map(Double.init)
            case "rebounds":
                return game.rebounds.map(Double.init)
            default:
                return game.points.map(Double.init)
            }
        }
        guard !values.isEmpty else { return "N/A" }
        let avg = values.reduce(0, +) / Double(values.count)
        return String(format: "%.1f", avg)
    }
}
