import SwiftUI

// MARK: - Sort / filter state

enum PropBoardSort: String, CaseIterable, Identifiable {
    case kickoffSoon = "Kickoff"
    case confidence = "Confidence"
    case mostLegs = "Player legs"

    var id: String { rawValue }
}

enum PropLegFilter: String, CaseIterable, Identifiable {
    case all = "All legs"
    case overs = "Overs"
    case unders = "Unders"
    case altLines = "Alt markets"

    var id: String { rawValue }
}

// MARK: - Confidence

struct PropConfidenceBadge: View {
    let percent: Int
    let tint: String

    var body: some View {
        let color: Color = {
            switch tint {
            case "green": return .green
            case "yellow": return .yellow
            default: return .orange
            }
        }()
        Text("\(percent)")
            .font(.system(size: 13, weight: .heavy))
            .foregroundColor(.black.opacity(0.78))
            .frame(minWidth: 38, minHeight: 38)
            .background(Circle().fill(color.opacity(0.92)))
            .overlay(Circle().stroke(Color.white.opacity(0.35), lineWidth: 1))
            .shadow(color: color.opacity(0.35), radius: 8, y: 2)
    }
}

// MARK: - Game header strip

struct PropGameHeaderStrip: View {
    let prop: Prop

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(prop.matchup)
                    .font(.system(size: 17, weight: .heavy))
                    .foregroundColor(.white)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    Label(prop.date, systemImage: "calendar")
                    Label(prop.time, systemImage: "clock")
                }
                .font(.caption.weight(.semibold))
                .foregroundColor(.white.opacity(0.65))
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 4) {
                Text(prop.badge)
                    .font(.caption.weight(.black))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.orange.opacity(0.22))
                    .foregroundColor(.orange)
                    .clipShape(Capsule())
                if let src = prop.source {
                    Text(src.replacingOccurrences(of: "_", with: " ").uppercased())
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(prop.isLiveOddsSource ? .green.opacity(0.95) : .yellow.opacity(0.85))
                }
            }
        }
    }
}

// MARK: - Core lines row

struct PropCoreLinesRow: View {
    let prop: Prop

    var body: some View {
        HStack(spacing: 10) {
            linePill(title: "Spread", value: prop.spread)
            linePill(title: "Total", value: prop.total)
            linePill(title: "ML", value: prop.moneyline)
        }
    }

    private func linePill(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .bold))
                .foregroundColor(.white.opacity(0.5))
            Text(value)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.white.opacity(0.92))
                .lineLimit(2)
                .minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.black.opacity(0.35))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
        .cornerRadius(10)
    }
}

// MARK: - Single player leg — unique panel

struct PlayerPropLegPanel: View {
    let sport: String
    let leg: PlayerProp
    let index: Int
    var inShelf: Bool = false
    var onShelfToggle: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("\(index)")
                .font(.system(size: 11, weight: .black))
                .foregroundColor(.black.opacity(0.75))
                .frame(width: 26, height: 26)
                .background(Color.cyan.opacity(0.85))
                .clipShape(RoundedRectangle(cornerRadius: 8))

            PropPlayerHeadshot(sport: sport, leg: leg)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(PropMarketKeyDisplay.label(for: leg.market))
                        .font(.caption.weight(.heavy))
                        .foregroundColor(.cyan.opacity(0.95))
                    if leg.synthetic == true {
                        Text("SYNTH")
                            .font(.system(size: 8, weight: .black))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.red.opacity(0.35))
                            .foregroundColor(.white)
                            .clipShape(Capsule())
                    }
                    Spacer(minLength: 0)
                }
                Text(leg.label ?? "—")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(3)
                HStack {
                    Text(leg.side ?? "—")
                        .font(.caption.weight(.bold))
                        .foregroundColor(sideColor(leg.side))
                    if let line = leg.line {
                        Text(String(format: "%.1f", line))
                            .font(.caption.monospacedDigit().weight(.bold))
                            .foregroundColor(.white.opacity(0.9))
                    }
                    if let odds = leg.odds {
                        Text(formatAmerican(odds))
                            .font(.caption.monospacedDigit().weight(.heavy))
                            .foregroundColor(.green.opacity(0.95))
                    }
                    Spacer(minLength: 0)
                    if let bk = leg.bookKey ?? leg.bookName {
                        Text(shortBook(bk))
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.white.opacity(0.55))
                    }
                }
            }

            if let onShelfToggle {
                Button {
                    EliteHaptics.light()
                    onShelfToggle()
                } label: {
                    Image(systemName: inShelf ? "cart.fill.badge.minus" : "cart.badge.plus")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(
                            LinearGradient(
                                colors: inShelf ? [.orange, .yellow] : [.cyan, .mint],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(width: 40, height: 40)
                        .background(Color.white.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(inShelf ? "Remove from shelf" : "Add to shelf")
            }
        }
        .padding(12)
        .background(
            LinearGradient(
                colors: [Color.white.opacity(0.09), Color.white.opacity(0.03)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [Color.purple.opacity(0.45), Color.cyan.opacity(0.25)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        .cornerRadius(14)
    }

    private func sideColor(_ side: String?) -> Color {
        guard let s = side?.lowercased() else { return .white.opacity(0.8) }
        if s.contains("over") { return .green }
        if s.contains("under") { return .orange }
        return .white.opacity(0.85)
    }

    private func formatAmerican(_ n: Int) -> String {
        if n > 0 { return "+\(n)" }
        return "\(n)"
    }

    private func shortBook(_ raw: String) -> String {
        let m: [String: String] = [
            "fanduel": "FD", "draftkings": "DK", "betmgm": "MGM",
            "williamhill_us": "CZR", "caesars": "CZR", "pointsbetus": "PB", "espnbet": "ESPN",
            "prizepicks": "PP", "underdog": "UD", "pick6": "P6", "betr_us_dfs": "BETR",
        ]
        let k = raw.lowercased()
        if k.count <= 4 { return raw.uppercased() }
        return m[k] ?? String(raw.prefix(4)).uppercased()
    }
}

// MARK: - Full event card

struct PropEventBoardCard: View {
    @ObservedObject private var shelf = PropShelfStore.shared

    let prop: Prop
    let legFilter: PropLegFilter
    let isTracked: Bool
    let onToggleTrack: () -> Void

    private var shareSlateText: String {
        var lines: [String] = [
            "Hit-A-Lick • \(prop.sport.uppercased())",
            prop.matchup,
            "\(prop.date) • \(prop.time)",
            "Spread \(prop.spread) | Total \(prop.total) | ML \(prop.moneyline)",
        ]
        if let src = prop.source {
            lines.append("Source: \(src)")
        }
        let pp = prop.playerProps ?? []
        if !pp.isEmpty {
            lines.append("Player legs:")
            for leg in pp.prefix(12) {
                let lbl = leg.label ?? "Leg"
                let odds = leg.odds.map { String($0) } ?? "—"
                let bk = leg.bookKey ?? leg.bookName ?? ""
                lines.append("• \(lbl) (\(odds))\(bk.isEmpty ? "" : " @ \(bk)")")
            }
        }
        return lines.joined(separator: "\n")
    }

    private var legs: [PlayerProp] {
        let raw = prop.playerProps ?? []
        switch legFilter {
        case .all:
            return raw
        case .overs:
            return raw.filter { ($0.side ?? "").lowercased().contains("over") }
        case .unders:
            return raw.filter { ($0.side ?? "").lowercased().contains("under") }
        case .altLines:
            return raw.filter { ($0.market ?? "").lowercased().contains("alternate") }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                PropGameHeaderStrip(prop: prop)
                Spacer(minLength: 8)
                PropConfidenceBadge(percent: prop.confidencePercent, tint: prop.confidenceTint)
            }

            PropCoreLinesRow(prop: prop)

            HStack {
                Text("Books")
                    .font(.caption.weight(.bold))
                    .foregroundColor(.white.opacity(0.55))
                Spacer()
                Text(prop.sportsbookSymbols)
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.white.opacity(0.85))
                    .lineLimit(2)
                    .multilineTextAlignment(.trailing)
            }

            if let rel = prop.analytics?.reliabilityScore {
                HStack {
                    Text("Reliability")
                        .font(.caption2.weight(.bold))
                        .foregroundColor(.white.opacity(0.5))
                    Spacer()
                    Text("\(rel)%")
                        .font(.caption2.weight(.heavy))
                        .foregroundColor(.mint)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Player prop legs")
                        .font(.subheadline.weight(.heavy))
                        .foregroundColor(.white)
                    Spacer()
                    Text("\(legs.count) shown")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.white.opacity(0.55))
                }

                if legs.isEmpty {
                    Text("No legs match this filter — try “All legs”.")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.65))
                        .padding(.vertical, 6)
                } else {
                    ForEach(Array(legs.enumerated()), id: \.offset) { idx, leg in
                        PlayerPropLegPanel(
                            sport: prop.sport,
                            leg: leg,
                            index: idx + 1,
                            inShelf: shelf.contains(propId: prop.id, leg: leg),
                            onShelfToggle: { shelf.toggle(prop: prop, leg: leg) }
                        )
                    }
                }
            }

            if let edges = prop.analytics?.topEdges, !edges.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    PropEdgeBarChart(edges: edges)
                    Text("EV edges (model)")
                        .font(.caption.weight(.heavy))
                        .foregroundColor(.green.opacity(0.9))
                    ForEach(edges.prefix(6)) { edge in
                        HStack(alignment: .top) {
                            Image(systemName: "bolt.circle.fill")
                                .foregroundColor(.yellow.opacity(0.9))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(edge.label ?? "Edge")
                                    .font(.caption.weight(.semibold))
                                    .foregroundColor(.white)
                                HStack(spacing: 8) {
                                    Text(edge.side ?? "—")
                                        .font(.caption2)
                                        .foregroundColor(.white.opacity(0.75))
                                    if let e = edge.edgePct {
                                        Text(String(format: "Edge %.2f%%", e))
                                            .font(.caption2.weight(.bold))
                                            .foregroundColor(.green)
                                    }
                                }
                            }
                            Spacer()
                        }
                    }
                }
                .padding(10)
                .background(Color.black.opacity(0.28))
                .cornerRadius(12)
            }

            HStack {
                Button(action: onToggleTrack) {
                    Label(isTracked ? "Tracked" : "Track game", systemImage: isTracked ? "bookmark.fill" : "bookmark")
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(isTracked ? .black : .white)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 14)
                        .background(isTracked ? Color.cyan : Color.white.opacity(0.12))
                        .cornerRadius(12)
                }
                .buttonStyle(.plain)

                Spacer()

                ShareLink(item: shareSlateText, subject: Text(prop.matchup), message: Text("Slate from Hit-A-Lick")) {
                    Label("Share slate", systemImage: "square.and.arrow.up")
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(.black)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 14)
                        .background(
                            LinearGradient(
                                colors: [Color.cyan, Color.green.opacity(0.85)],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .cornerRadius(10)
                }
                .simultaneousGesture(TapGesture().onEnded { EliteHaptics.light() })
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color.white.opacity(0.07))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [Color.white.opacity(0.22), Color.cyan.opacity(0.15)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1.2
                )
        )
        .shadow(color: .black.opacity(0.45), radius: 22, y: 12)
    }
}

// MARK: - Toolbar chips

struct PropQuickFilterBar: View {
    @Binding var sport: String
    @Binding var sort: PropBoardSort
    @Binding var legFilter: PropLegFilter
    let onRefresh: () -> Void

    private let sports = ["ALL", "NBA", "NFL", "MLB", "WNBA"]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(sports, id: \.self) { s in
                        Button {
                            sport = s
                            EliteHaptics.light()
                        } label: {
                            Text(s)
                                .font(.caption.weight(.bold))
                                .foregroundColor(sport == s ? .black : .white)
                                .padding(.vertical, 8)
                                .padding(.horizontal, 12)
                                .background(sport == s ? Color.orange : Color.white.opacity(0.1))
                                .clipShape(Capsule())
                        }
                    }
                    Button(action: onRefresh) {
                        Image(systemName: "arrow.clockwise.circle.fill")
                            .font(.title2)
                            .foregroundColor(.cyan)
                    }
                }
            }
            HStack {
                Picker("Sort", selection: $sort) {
                    ForEach(PropBoardSort.allCases) { s in
                        Text(s.rawValue).tag(s)
                    }
                }
                .pickerStyle(.segmented)

                Picker("Legs", selection: $legFilter) {
                    ForEach(PropLegFilter.allCases) { f in
                        Text(f.rawValue).tag(f)
                    }
                }
                .pickerStyle(.menu)
            }
        }
    }
}
