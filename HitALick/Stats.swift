import SwiftUI

struct Stats: View {
    @State private var selectedMode: String = "Player"
    @State private var selectedSport: String = "ALL"
    @StateObject private var viewModel = StatsViewModel()

    @State private var expandedStatId: UUID?
    @State private var selectedStatType: String = "Points"
    @State private var searchText: String = ""

    let statTypes = ["Points", "Assists", "Rebounds"]
    let modes = ["Player", "Team"]
    let sports = ["ALL", "NBA", "NFL", "MLB", "WNBA"]

    var filteredStats: [EntityStat] {
        if searchText.isEmpty {
            return viewModel.entities
        } else {
            return viewModel.entities.filter {
                $0.name.lowercased().contains(searchText.lowercased())
            }
        }
    }

    var body: some View {
        ZStack {
            EliteBackground()

            VStack(spacing: 12) {
                HStack(spacing: 16) {
                    Picker("Mode", selection: $selectedMode) {
                        ForEach(modes, id: \.self) { Text($0) }
                    }
                    Picker("Sport", selection: $selectedSport) {
                        ForEach(sports, id: \.self) { Text($0) }
                    }
                }
                .pickerStyle(SegmentedPickerStyle())
                .onChange(of: selectedMode) { _ in
                    viewModel.loadStats(for: selectedSport, mode: selectedMode)
                }
                .onChange(of: selectedSport) { _ in
                    viewModel.loadStats(for: selectedSport, mode: selectedMode)
                }

                TextField("Search by name...", text: $searchText)
                    .padding()
                    .background(Color.white.opacity(0.2))
                    .cornerRadius(8)
                    .foregroundColor(.white)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(statTypes, id: \.self) { type in
                            Button {
                                selectedStatType = type
                            } label: {
                                Text(type)
                                    .font(.caption.weight(.semibold))
                                    .foregroundColor(selectedStatType == type ? .black : .white)
                                    .padding(.vertical, 8)
                                    .padding(.horizontal, 12)
                                    .background(selectedStatType == type ? Color.orange : Color.white.opacity(0.14))
                                    .cornerRadius(999)
                            }
                        }
                    }
                }

                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(filteredStats) { stat in
                            StatCard(
                                stat: stat,
                                isExpanded: expandedStatId == stat.id,
                                selectedStatType: $selectedStatType,
                                onToggleExpand: {
                                    withAnimation {
                                        expandedStatId = (expandedStatId == stat.id) ? nil : stat.id
                                    }
                                }
                            )
                        }
                    }
                    .padding(.bottom, 40)
                }
            }
            .padding()
        }
        .onAppear {
            viewModel.loadStats(for: selectedSport, mode: selectedMode)
        }
        .screenEntrance()
    }
}

struct StatCard: View {
    let stat: EntityStat
    let isExpanded: Bool
    @Binding var selectedStatType: String
    var onToggleExpand: () -> Void

    var body: some View {
        ElitePanel {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(stat.name)
                            .font(.headline)
                            .foregroundColor(.white)

                        Text("Position: \(stat.position ?? "-")")
                            .font(.caption)
                            .foregroundColor(.gray)
                    }

                    Spacer()

                    if let headshot = stat.headshot, let url = URL(string: headshot), UIApplication.shared.canOpenURL(url) {
                        AsyncImage(url: url) { image in
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: 50, height: 50)
                                .clipShape(Circle())
                        } placeholder: {
                            ProgressView()
                        }
                    } else {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 46))
                            .foregroundColor(.white.opacity(0.5))
                    }
                }

                statPanel(title: "Player Panel") {
                    Text("Name: \(stat.name)")
                    Text("Role: \(stat.position ?? "-")")
                }
                statPanel(title: "Game Panel") {
                    Text("Sample Size: \(stat.statHistory.count) games")
                    Text("Mode: analytics trend board")
                }
                statPanel(title: "Prop Panel") {
                    Text("Type: \(selectedStatType)")
                    Text("Average: \(averageForSelectedType(stat: stat))")
                }

                if isExpanded {
                    Rectangle()
                        .fill(Color.white.opacity(0.12))
                        .frame(height: 1)
                    Text("Expanded analytics view enabled for \(selectedStatType).")
                        .font(.caption2)
                        .foregroundColor(.white.opacity(0.7))
                }
            }
            .onTapGesture {
                onToggleExpand()
            }
        }
    }

    @ViewBuilder
    private func statPanel<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.caption2)
                .foregroundColor(.blue.opacity(0.9))
            content()
                .font(.caption)
                .foregroundColor(.white.opacity(0.9))
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black.opacity(0.28))
        .cornerRadius(10)
    }

    private func averageForSelectedType(stat: EntityStat) -> String {
        let key: String
        switch selectedStatType.lowercased() {
        case "assists":
            key = "assists"
        case "rebounds":
            key = "rebounds"
        default:
            key = "points"
        }
        let values: [Double] = stat.statHistory.compactMap { game in
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
