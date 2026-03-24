import SwiftUI

// MARK: - Dashboard aggregates (client-computed)

struct PropDeskStats {
    var totalGames: Int = 0
    var totalPlayerLegs: Int = 0
    var liveOddsGames: Int = 0
    var fallbackGames: Int = 0
    var avgConfidence: Double = 0
    var bySport: [String: Int] = [:]
}

private func buildDeskStats(from props: [Prop]) -> PropDeskStats {
    var s = PropDeskStats()
    s.totalGames = props.count
    for p in props {
        s.totalPlayerLegs += (p.playerProps ?? []).count
        if p.isLiveOddsSource { s.liveOddsGames += 1 } else { s.fallbackGames += 1 }
        let sp = p.sport.uppercased()
        s.bySport[sp, default: 0] += 1
    }
    let conf = props.map { Double($0.confidencePercent) }
    if !conf.isEmpty {
        s.avgConfidence = conf.reduce(0, +) / Double(conf.count)
    }
    return s
}

// MARK: - View

struct EliteDashboardView: View {
    @State private var snapshot: PropsSnapshotEnvelope?
    @State private var ops: OpsDashboardResponse?
    @State private var isLoading = true
    @State private var lastError: String?
    @State private var selectedSportFilter = "ALL"

    private var filteredProps: [Prop] {
        let all = snapshot?.props ?? []
        if selectedSportFilter == "ALL" { return all }
        return all.filter { $0.sport.uppercased() == selectedSportFilter }
    }

    private var desk: PropDeskStats {
        buildDeskStats(from: filteredProps)
    }

    var body: some View {
        ZStack {
            EliteBackground()
            ScrollView {
                VStack(spacing: 18) {
                    header
                    sportFilter
                    kpiRow
                    tierStrip
                    sportBreakdown
                    apiStatusCard
                    notesCard
                    marketsReference
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 18)
            }
            if isLoading {
                Color.black.opacity(0.35).ignoresSafeArea()
                ProgressView("Syncing desk…")
                    .tint(.cyan)
                    .foregroundColor(.white)
            }
        }
        .navigationTitle("Elite Desk")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: reload)
        .refreshable { reload() }
        .screenEntrance()
    }

    private var header: some View {
        ElitePanel {
            VStack(alignment: .leading, spacing: 8) {
                Text("Command Center")
                    .font(.title2.weight(.heavy))
                    .foregroundColor(.white)
                Text("Live board health, API tier, and slate norms — tuned to NBA / NFL / MLB / WNBA.")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.78))
                if let gen = snapshot?.generatedAt ?? ops?.generatedAt {
                    Text("Last payload: \(gen)")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(.cyan.opacity(0.85))
                }
                if let w = snapshot?.warning, !w.isEmpty {
                    Text(w)
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(.yellow.opacity(0.95))
                        .padding(.top, 4)
                }
                if let e = lastError {
                    Text(e)
                        .font(.caption2)
                        .foregroundColor(.red.opacity(0.9))
                }
            }
        }
    }

    private var sportFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(["ALL", "NBA", "NFL", "MLB", "WNBA"], id: \.self) { s in
                    Button {
                        selectedSportFilter = s
                        EliteHaptics.light()
                    } label: {
                        Text(s)
                            .font(.caption.weight(.bold))
                            .foregroundColor(selectedSportFilter == s ? .black : .white)
                            .padding(.vertical, 8)
                            .padding(.horizontal, 12)
                            .background(selectedSportFilter == s ? Color.cyan : Color.white.opacity(0.1))
                            .clipShape(Capsule())
                    }
                }
            }
        }
    }

    private var kpiRow: some View {
        let legs = snapshot?.totalPlayerProps ?? desk.totalPlayerLegs
        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            dashTile(title: "Games", value: "\(desk.totalGames)", subtitle: "In window")
            dashTile(title: "Player legs", value: "\(legs)", subtitle: "Σ props")
            dashTile(title: "Live odds", value: "\(desk.liveOddsGames)", subtitle: "Odds API / Rapid")
            dashTile(title: "Avg conf.", value: String(format: "%.0f", desk.avgConfidence), subtitle: "Model blend")
        }
    }

    private func dashTile(title: String, value: String, subtitle: String) -> some View {
        ElitePanel {
            VStack(alignment: .leading, spacing: 4) {
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.white.opacity(0.55))
                Text(value)
                    .font(.system(size: 26, weight: .heavy))
                    .foregroundColor(.white)
                Text(subtitle)
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.6))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var tierStrip: some View {
        ElitePanel {
            VStack(alignment: .leading, spacing: 10) {
                Text("Odds API tier")
                    .font(.headline.weight(.bold))
                    .foregroundColor(.white)
                let tier = ops?.env?.activePropMarketTier ?? snapshot?.coverage?.propMarketTier ?? "standard"
                Text(tier.uppercased())
                    .font(.title3.weight(.heavy))
                    .foregroundColor(.orange)
                Text(tierCopy(tier))
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.78))
                if let ttl = snapshot?.coverage?.cacheTtlSeconds {
                    Text("Cache TTL: \(ttl)s — pulls coalesce to protect quota.")
                        .font(.caption2)
                        .foregroundColor(.white.opacity(0.55))
                }
            }
        }
    }

    private func tierCopy(_ tier: String) -> String {
        switch tier.lowercased() {
        case "core": return OddsPropTierCopy.core
        case "full": return OddsPropTierCopy.full
        default: return OddsPropTierCopy.standard
        }
    }

    private var sportBreakdown: some View {
        ElitePanel {
            VStack(alignment: .leading, spacing: 10) {
                Text("Slate by sport")
                    .font(.headline.weight(.bold))
                    .foregroundColor(.white)
                ForEach(Array(desk.bySport.keys.sorted()), id: \.self) { k in
                    HStack {
                        Text(k)
                            .font(.subheadline.weight(.semibold))
                            .foregroundColor(.white)
                        Spacer()
                        Text("\(desk.bySport[k] ?? 0) games")
                            .font(.caption.weight(.bold))
                            .foregroundColor(.cyan)
                    }
                    Divider().background(Color.white.opacity(0.12))
                }
                if desk.bySport.isEmpty {
                    Text("Pull to refresh after games load.")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.6))
                }
            }
        }
    }

    private var apiStatusCard: some View {
        ElitePanel {
            VStack(alignment: .leading, spacing: 8) {
                Text("Provider readiness")
                    .font(.headline.weight(.bold))
                    .foregroundColor(.white)
                HStack {
                    statusDot(ops?.env?.oddsApiKeyPresent == true)
                    Text("Odds API key")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.white.opacity(0.85))
                    Spacer()
                    Text(ops?.env?.oddsApiKeyPresent == true ? "Present" : "Missing")
                        .font(.caption.weight(.bold))
                        .foregroundColor(ops?.env?.oddsApiKeyPresent == true ? .green : .red)
                }
                HStack {
                    statusDot(ops?.env?.rapidApiConfigured == true)
                    Text("Rapid fallback")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.white.opacity(0.85))
                    Spacer()
                    Text(ops?.env?.rapidApiConfigured == true ? "Ready" : "Off")
                        .font(.caption.weight(.bold))
                        .foregroundColor(ops?.env?.rapidApiConfigured == true ? .green : .orange)
                }
                Text("When Odds API is live, synthetic legs are stripped server-side and headshots hydrate from ESPN ids when available.")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.55))
            }
        }
    }

    private func statusDot(_ ok: Bool) -> some View {
        Circle()
            .fill(ok ? Color.green : Color.red.opacity(0.85))
            .frame(width: 8, height: 8)
    }

    private var notesCard: some View {
        ElitePanel {
            VStack(alignment: .leading, spacing: 8) {
                Text("Ops notes")
                    .font(.headline.weight(.bold))
                    .foregroundColor(.white)
                if let lines = ops?.notes {
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "checkmark.seal.fill")
                                .foregroundColor(.mint)
                            Text(line)
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.78))
                        }
                    }
                } else {
                    Text("Open `/ops/dashboard` on the API for the same JSON this panel consumes.")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.65))
                }
            }
        }
    }

    private var marketsReference: some View {
        ElitePanel {
            VStack(alignment: .leading, spacing: 12) {
                Text("Retail norms (priced legs / slate)")
                    .font(.headline.weight(.bold))
                    .foregroundColor(.white)
                let map = ops?.typicalPricedLegsPerSlateRetail ?? [
                    "nba": PropSlateNorms.nbaPricedLegRange,
                    "wnba": PropSlateNorms.wnbaPricedLegRange,
                    "nfl": PropSlateNorms.nflPricedLegRange,
                    "mlb": PropSlateNorms.mlbPricedLegRange,
                ]
                ForEach(Array(map.keys.sorted()), id: \.self) { k in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(k.uppercased())
                            .font(.caption.weight(.heavy))
                            .foregroundColor(.orange.opacity(0.95))
                        Text(PropSlateNorms.retailNote(for: k))
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.65))
                        Text("Typical priced legs: \(map[k] ?? "—")")
                            .font(.caption2.weight(.semibold))
                            .foregroundColor(.cyan.opacity(0.85))
                    }
                    .padding(.vertical, 4)
                }

                if let m = ops?.marketsBySport {
                    Text("Active Odds API keys (count)")
                        .font(.caption.weight(.heavy))
                        .foregroundColor(.white.opacity(0.75))
                        .padding(.top, 6)
                    ForEach(Array(m.keys.sorted()), id: \.self) { k in
                        HStack {
                            Text(k.uppercased())
                            Spacer()
                            Text("\(m[k]?.count ?? 0) markets")
                                .foregroundColor(.white.opacity(0.65))
                                .font(.caption2)
                        }
                    }
                }
            }
        }
    }

    private func reload() {
        isLoading = true
        lastError = nil
        Task { @MainActor in
            do {
                async let snapTask = APIServices.shared.fetchPropsSnapshot(for: "ALL")
                async let opsTask = APIServices.shared.fetchOpsDashboard()
                let (snap, opsData) = try await (snapTask, opsTask)
                snapshot = snap
                ops = opsData
            } catch {
                lastError = error.localizedDescription
            }
            isLoading = false
        }
    }
}
