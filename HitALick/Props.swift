import SwiftUI

// MARK: - Board helpers

private enum PropBoardTabs: String, CaseIterable, Hashable {
    case best = "Best slate"
    case all = "All games"
    case tracked = "Tracked"
}

/// Hide pregame props once the event has started; keep second-half tagged props until ~halftime window.
private func propIsStale(_ prop: Prop) -> Bool {
    guard let start = prop.eventStartDate else { return false }
    let now = Date()
    let tags = (prop.tags ?? []).map { $0.lowercased() }
    let secondHalfish = tags.contains { t in
        t.contains("2h") || t.contains("2nd") || t.contains("second_half") || t.contains("halftime") || t.contains("h2")
    }
    if secondHalfish {
        return now > start.addingTimeInterval(2.25 * 3600)
    }
    return now > start.addingTimeInterval(90)
}

private extension Array where Element == Prop {
    func sortedBoard(_ mode: PropBoardSort) -> [Prop] {
        switch mode {
        case .kickoffSoon:
            return sorted { a, b in
                let da = a.eventStartDate ?? .distantFuture
                let db = b.eventStartDate ?? .distantFuture
                return da < db
            }
        case .confidence:
            return sorted { $0.confidencePercent > $1.confidencePercent }
        case .mostLegs:
            return sorted { ($0.playerProps ?? []).count > ($1.playerProps ?? []).count }
        }
    }
}

// MARK: - Main board

struct Props: View {
    @ObservedObject private var tracked = PropTrackingStore.shared
    @ObservedObject private var shelf = PropShelfStore.shared

    @State private var showPropShelf = false
    @State private var boardTab: PropBoardTabs = .best
    @State private var selectedSport: String = "ALL"
    @State private var sortMode: PropBoardSort = .kickoffSoon
    @State private var legFilter: PropLegFilter = .all
    @State private var searchText: String = ""
    @State private var props: [Prop] = []
    @State private var isLoading = true
    @State private var lastRefresh: Date?
    @State private var apiWarning: String?

    private var baseList: [Prop] {
        props
            .filter { !propIsStale($0) }
            .filter { p in
                if selectedSport == "ALL" { return true }
                return p.sport.uppercased() == selectedSport.uppercased()
            }
            .filter { p in
                guard !searchText.isEmpty else { return true }
                let q = searchText.lowercased()
                return p.matchup.lowercased().contains(q)
                    || (p.playerProps ?? []).contains { leg in
                        (leg.label ?? "").lowercased().contains(q)
                            || (leg.playerName ?? "").lowercased().contains(q)
                    }
            }
            .sortedBoard(sortMode)
    }

    private var displayList: [Prop] {
        switch boardTab {
        case .best:
            return Array(baseList.prefix(24))
        case .all:
            return baseList
        case .tracked:
            return baseList.filter { tracked.contains($0.id) }
        }
    }

    var body: some View {
        ZStack {
            EliteBackground()

            VStack(spacing: 0) {
                PropQuickFilterBar(
                    sport: $selectedSport,
                    sort: $sortMode,
                    legFilter: $legFilter,
                    onRefresh: { Task { @MainActor in await loadProps(showLoader: true) } }
                )
                .padding(.horizontal, 12)
                .padding(.top, 8)

                tabBar
                    .padding(.horizontal, 12)
                    .padding(.top, 10)

                searchField
                    .padding(.horizontal, 12)
                    .padding(.top, 8)

                if let w = apiWarning, !w.isEmpty {
                    Text(w)
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(.yellow.opacity(0.95))
                        .padding(.horizontal, 14)
                        .padding(.top, 6)
                }

                ScrollView {
                    LazyVStack(spacing: 18) {
                        if isLoading {
                            ForEach(0..<5, id: \.self) { _ in
                                SkeletonBlock().padding(.horizontal, 12)
                            }
                        } else if displayList.isEmpty {
                            EmptyStateCard(
                                title: boardTab == .tracked ? "No tracked games" : "No props in this window",
                                message: "Pull to refresh, widen sport to ALL, or check Odds API quota on the Elite Desk."
                            )
                            .padding(.horizontal, 12)
                            .padding(.top, 20)
                        } else {
                            ForEach(displayList) { prop in
                                PropEventBoardCard(
                                    prop: prop,
                                    legFilter: legFilter,
                                    isTracked: tracked.contains(prop.id),
                                    onToggleTrack: {
                                        EliteHaptics.medium()
                                        tracked.toggle(prop.id)
                                    }
                                )
                                .padding(.horizontal, 12)
                            }
                        }
                    }
                    .padding(.vertical, 14)
                }
                .refreshable { await loadProps(showLoader: false) }
            }
        }
        .task(id: selectedSport) {
            await loadProps(showLoader: true)
        }
        .navigationTitle("Props Board")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    EliteHaptics.light()
                    shelf.pruneExpired()
                    showPropShelf = true
                } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "shippingbox.circle.fill")
                            .font(.title2)
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.cyan, .white.opacity(0.35))
                        if shelf.legs.count > 0 {
                            Text("\(min(shelf.legs.count, 99))")
                                .font(.system(size: 10, weight: .black))
                                .foregroundColor(.black)
                                .padding(4)
                                .background(Capsule().fill(Color.orange))
                                .offset(x: 8, y: -8)
                        }
                    }
                }
                .accessibilityLabel("Open prop shelf")
            }
        }
        .sheet(isPresented: $showPropShelf) {
            PropShelfSheet()
        }
        .screenEntrance()
    }

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(PropBoardTabs.allCases, id: \.self) { tab in
                Button {
                    boardTab = tab
                    EliteHaptics.light()
                } label: {
                    VStack(spacing: 6) {
                        Text(tab.rawValue)
                            .font(.system(size: 13, weight: boardTab == tab ? .heavy : .semibold))
                            .foregroundColor(boardTab == tab ? .orange : .white.opacity(0.65))
                        Rectangle()
                            .fill(boardTab == tab ? Color.orange : Color.clear)
                            .frame(height: 3)
                            .cornerRadius(2)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var searchField: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.white.opacity(0.55))
            TextField("Matchups, players, markets…", text: $searchText)
                .textFieldStyle(.plain)
                .foregroundColor(.white)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
        .padding(12)
        .background(Color.white.opacity(0.08))
        .cornerRadius(14)
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
    }

    @MainActor
    private func loadProps(showLoader: Bool) async {
        if showLoader { isLoading = true }
        defer { isLoading = false }
        do {
            let env = try await APIServices.shared.fetchPropsSnapshot(for: selectedSport)
            props = env.props
            apiWarning = env.warning
            lastRefresh = Date()
        } catch {
            print("❌ Props snapshot error:", error.localizedDescription)
            props = []
            apiWarning = error.localizedDescription
        }
    }
}
