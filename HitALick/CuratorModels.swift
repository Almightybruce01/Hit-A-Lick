import Foundation

/// `GET /api/curators/:id/board`
struct CuratorBoardAPIResponse: Decodable {
    let curatorId: String
    let label: String
    let profile: CuratorBoardProfile
    let upcoming: [CuratorPickRow]
    let parlays: [CuratorParlayRow]?
    let history: [CuratorHistoryRow]
}

struct CuratorBoardProfile: Decodable {
    let displayName: String?
    let photoDataUrl: String?
    let backgroundImageDataUrl: String?
    let accentHex: String?
    let backgroundHex: String?
    let wins: Int?
    let losses: Int?
    let pushes: Int?
    let winPct: Double?
}

struct CuratorParlayLeg: Decodable {
    let label: String?
    let odds: Int?
}

struct CuratorParlayRow: Decodable, Identifiable {
    let id: String?
    let title: String?
    let legs: [CuratorParlayLeg]?
    let note: String?

    var stableId: String {
        if let id, !id.isEmpty { return id }
        return "\(title ?? "parlay")-\(note ?? "")"
    }
}

struct CuratorPickRow: Decodable, Identifiable {
    let id: String?
    let title: String?
    let league: String?
    let pick: String?
    let notes: String?
    let confidence: Double?
    let gameDate: String?

    var stableId: String {
        if let id, !id.isEmpty { return id }
        return "\(title ?? "")-\(pick ?? "")-\(gameDate ?? "")"
    }
}

struct CuratorHistoryRow: Decodable, Identifiable {
    let id: String?
    let poolItemId: String?
    let title: String?
    let league: String?
    let pick: String?
    let result: String?
    let notes: String?
    let gameDate: String?
    let settledAt: String?

    var stableId: String {
        if let id, !id.isEmpty { return id }
        return "\(title ?? "")-\(settledAt ?? "")-\(result ?? "")"
    }
}

struct CuratorCatalogResponse: Decodable {
    struct Entry: Decodable, Identifiable {
        let id: String
        let label: String
    }

    let curators: [Entry]
}

struct BillingEntitlementPayload: Decodable {
    let active: Bool?
    let tier: String?
    let curatorAllAccess: Bool?
    let curatorIds: [String]?
}

struct BillingEntitlementResponse: Decodable {
    let entitlement: BillingEntitlementPayload?
}

struct CuratorMeResponse: Decodable {
    let curatorId: String?
    let isOwner: Bool?
    let canEditPool: Bool?
}

extension CuratorBoardAPIResponse {
    static func preview(slug: String) -> CuratorBoardAPIResponse {
        CuratorBoardAPIResponse(
            curatorId: slug,
            label: labelForSlug(slug),
            profile: CuratorBoardProfile(
                displayName: labelForSlug(slug),
                photoDataUrl: nil,
                backgroundImageDataUrl: nil,
                accentHex: "#ff9f0a",
                backgroundHex: "#0a1227",
                wins: 12,
                losses: 5,
                pushes: 1,
                winPct: 70.6
            ),
            upcoming: [
                CuratorPickRow(
                    id: "p1",
                    title: "Preview leg",
                    league: "NBA",
                    pick: "Points over",
                    notes: "Sample upcoming pick from the universal pool.",
                    confidence: 88,
                    gameDate: "Today",
                ),
            ],
            history: [
                CuratorHistoryRow(
                    id: "h1",
                    poolItemId: nil,
                    title: "Yesterday's play",
                    league: "NBA",
                    pick: "Spread",
                    result: "win",
                    notes: "",
                    gameDate: "Yesterday",
                    settledAt: ISO8601DateFormatter().string(from: Date()),
                ),
            ],
            parlays: [
                CuratorParlayRow(
                    id: "pl1",
                    title: "Preview parlay",
                    legs: [
                        CuratorParlayLeg(label: "Leg A -110", odds: -110),
                        CuratorParlayLeg(label: "Leg B +140", odds: 140),
                    ],
                    note: "Sample featured slip.",
                ),
            ],
        )
    }

    static func previewAll() -> [String: CuratorBoardAPIResponse] {
        var out: [String: CuratorBoardAPIResponse] = [:]
        for s in ["giap", "bruce", "mike", "toriano"] {
            out[s] = preview(slug: s)
        }
        return out
    }

    private static func labelForSlug(_ slug: String) -> String {
        switch slug {
        case "giap": return "Giap Pick's"
        case "bruce": return "Bruce Pick's"
        case "mike": return "Mike Pick's"
        case "toriano": return "Toriano Pick's"
        default: return slug
        }
    }
}

extension CuratorBoardAPIResponse {
    init(
        curatorId: String,
        label: String,
        profile: CuratorBoardProfile,
        upcoming: [CuratorPickRow],
        history: [CuratorHistoryRow],
        parlays: [CuratorParlayRow]? = nil,
    ) {
        self.curatorId = curatorId
        self.label = label
        self.profile = profile
        self.upcoming = upcoming
        self.history = history
        self.parlays = parlays
    }
}
