import Foundation

/// `GET /api/curators/:id/board`
struct CuratorBoardAPIResponse: Decodable {
    let curatorId: String
    let label: String
    /// ISO8601 when picks were last posted to this board (server).
    let lastPickPostAt: String?
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
    let staffRole: String?
    let aiUnlimited: Bool?
    /// From `/api/billing/entitlements` after Stripe webhook merge (`billing.js`).
    let hasRegular: Bool?
    let hasPremium: Bool?
    let hasAppAccess: Bool?

    /// Bruce + Giap staff — full product access (no in-app purchases).
    var unlocksStaffVIPFeatures: Bool {
        guard active == true else { return false }
        if let s = staffRole, !s.isEmpty { return true }
        if curatorAllAccess == true { return true }
        return false
    }

    /// Regular website subscription unlocks the app; Premium AI add-on alone does not (Apple-compliant web checkout).
    var effectiveHasAppAccess: Bool {
        if unlocksStaffVIPFeatures { return true }
        if hasAppAccess == true { return true }
        if hasRegular == true { return true }
        let t = (tier ?? "").lowercased()
        if t == "staff" || t == "premium_ai" || t == "premium_bundle" || t == "premium_all" { return true }
        // Legacy Firestore rows that used `tier: premium` for full app + AI bundle.
        if t == "premium", hasRegular != false { return true }
        return false
    }

    var effectiveAiUnlimited: Bool {
        if unlocksStaffVIPFeatures { return true }
        if aiUnlimited == true { return true }
        if hasPremium == true, effectiveHasAppAccess { return true }
        let t = (tier ?? "").lowercased()
        if (t == "premium_ai" || t == "premium_bundle" || t == "premium_all" || t == "staff"), effectiveHasAppAccess { return true }
        return false
    }
}

struct BillingEntitlementResponse: Decodable {
    let entitlement: BillingEntitlementPayload?
}

struct CuratorMeResponse: Decodable {
    let curatorId: String?
    let curatorDisplayName: String?
    let isOwner: Bool?
    let isCoCurator: Bool?
    let canEditPool: Bool?
    let canSelectUniversalPool: Bool?
}

extension CuratorBoardAPIResponse {
    static func preview(slug: String) -> CuratorBoardAPIResponse {
        CuratorBoardAPIResponse(
            curatorId: slug,
            label: labelForSlug(slug),
            lastPickPostAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3600)),
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
        for s in ["bruce", "giap"] {
            out[s] = preview(slug: s)
        }
        return out
    }

    private static func labelForSlug(_ slug: String) -> String {
        switch slug {
        case "giap": return "Giap Pick's"
        case "bruce": return "Bruce Pick's"
        default: return slug
        }
    }
}

extension CuratorBoardAPIResponse {
    init(
        curatorId: String,
        label: String,
        lastPickPostAt: String? = nil,
        profile: CuratorBoardProfile,
        upcoming: [CuratorPickRow],
        history: [CuratorHistoryRow],
        parlays: [CuratorParlayRow]? = nil,
    ) {
        self.curatorId = curatorId
        self.label = label
        self.lastPickPostAt = lastPickPostAt
        self.profile = profile
        self.upcoming = upcoming
        self.history = history
        self.parlays = parlays
    }
}
