import Foundation
import SwiftUI
import Combine

/// Local-only cart of player prop legs (no billing; for quick rebuild on your book).
struct PropShelfLeg: Identifiable, Codable, Equatable {
    var id: String
    var propId: String
    var sport: String
    var matchup: String
    var eventDateYmd: String
    var commenceTime: String?
    var market: String?
    var label: String?
    var side: String?
    var line: Double?
    var odds: Int?
    var bookKey: String?
    var addedAt: Date

    static func shelfId(propId: String, leg: PlayerProp) -> String {
        "\(propId)::\(leg.id)"
    }

    static func make(prop: Prop, leg: PlayerProp) -> PropShelfLeg {
        PropShelfLeg(
            id: shelfId(propId: prop.id, leg: leg),
            propId: prop.id,
            sport: prop.sport,
            matchup: prop.matchup,
            eventDateYmd: prop.date,
            commenceTime: prop.commenceTime,
            market: leg.market,
            label: leg.label,
            side: leg.side,
            line: leg.line,
            odds: leg.odds,
            bookKey: leg.bookKey ?? leg.bookName,
            addedAt: Date()
        )
    }

    /// True after kickoff + short slack (mirrors board stale window).
    func isExpired(now: Date = Date()) -> Bool {
        if let start = PropFormatters.eventDate(dateYmd: eventDateYmd, commenceISO: commenceTime) {
            return now > start.addingTimeInterval(5 * 3600)
        }
        let raw = String(eventDateYmd.prefix(10))
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone.current
        df.dateFormat = "yyyy-MM-dd"
        guard let d = df.date(from: raw) else { return false }
        return now > d.addingTimeInterval(26 * 3600)
    }
}

@MainActor
final class PropShelfStore: ObservableObject {
    static let shared = PropShelfStore()

    private let storageKey = "hit_a_lick.prop_shelf.v1"

    @Published private(set) var legs: [PropShelfLeg] = []

    private init() {
        load()
        pruneExpired()
    }

    func contains(propId: String, leg: PlayerProp) -> Bool {
        let sid = PropShelfLeg.shelfId(propId: propId, leg: leg)
        return legs.contains { $0.id == sid }
    }

    func toggle(prop: Prop, leg: PlayerProp) {
        let item = PropShelfLeg.make(prop: prop, leg: leg)
        if let i = legs.firstIndex(where: { $0.id == item.id }) {
            legs.remove(at: i)
        } else {
            legs.insert(item, at: 0)
        }
        save()
    }

    func remove(id: String) {
        legs.removeAll { $0.id == id }
        save()
    }

    func clear() {
        legs = []
        save()
    }

    func pruneExpired() {
        let before = legs.count
        legs.removeAll { $0.isExpired() }
        if legs.count != before { save() }
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: storageKey) else { return }
        if let decoded = try? JSONDecoder().decode([PropShelfLeg].self, from: data) {
            legs = decoded
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(legs) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }
}

// MARK: - Shelf sheet

struct PropShelfSheet: View {
    @ObservedObject private var shelf = PropShelfStore.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                EliteBackground()
                if shelf.legs.isEmpty {
                    EmptyStateCard(
                        title: "Shelf is empty",
                        message: "Tap + on any player leg to stash it. Verify prices on your book before you bet."
                    )
                    .padding(24)
                } else {
                    List {
                        ForEach(shelf.legs) { leg in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(leg.matchup)
                                    .font(.subheadline.weight(.heavy))
                                    .foregroundColor(.white)
                                Text(leg.label ?? "Leg")
                                    .font(.caption.weight(.semibold))
                                    .foregroundColor(.cyan.opacity(0.95))
                                HStack {
                                    Text(leg.sport.uppercased())
                                        .font(.caption2.weight(.bold))
                                        .foregroundColor(.orange)
                                    if let bk = leg.bookKey {
                                        Text(shortBookLabel(bk))
                                            .font(.caption2.weight(.heavy))
                                            .foregroundColor(.white.opacity(0.55))
                                    }
                                    Spacer()
                                    if let odds = leg.odds {
                                        Text(formatAmerican(odds))
                                            .font(.caption.monospacedDigit().weight(.heavy))
                                            .foregroundColor(.green)
                                    }
                                }
                            }
                            .listRowBackground(Color.white.opacity(0.06))
                        }
                        .onDelete { indexSet in
                            let ids = indexSet.compactMap { shelf.legs.indices.contains($0) ? shelf.legs[$0].id : nil }
                            ids.forEach { shelf.remove(id: $0) }
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .navigationTitle("Prop shelf")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .foregroundColor(.cyan)
                }
                ToolbarItem(placement: .primaryAction) {
                    if !shelf.legs.isEmpty {
                        Button("Clear") {
                            EliteHaptics.medium()
                            shelf.clear()
                        }
                        .foregroundColor(.orange)
                    }
                }
            }
            .onAppear { shelf.pruneExpired() }
        }
    }

    private func formatAmerican(_ n: Int) -> String {
        if n > 0 { return "+\(n)" }
        return "\(n)"
    }

    private func shortBookLabel(_ raw: String) -> String {
        let m: [String: String] = [
            "fanduel": "FD", "draftkings": "DK", "betmgm": "MGM",
            "williamhill_us": "CZR", "caesars": "CZR", "prizepicks": "PP",
            "underdog": "UD", "pick6": "P6", "betr_us_dfs": "BETR",
        ]
        let k = raw.lowercased()
        return m[k] ?? String(raw.prefix(5)).uppercased()
    }
}
