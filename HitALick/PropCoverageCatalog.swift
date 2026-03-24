import Foundation

// MARK: - Sport-tuned prop coverage (mirrors `propMarketTuning.js` + retail desk norms)

/// Typical *priced* player-prop legs visible on a full NBA slate (Odds API retail mix — not a hard cap).
enum PropSlateNorms {
    static let nbaPricedLegRange = "18–26"
    static let wnbaPricedLegRange = "16–22"
    static let nflPricedLegRange = "22–34"
    static let mlbPricedLegRange = "12–20"

    static func retailNote(for sportCode: String) -> String {
        switch sportCode.uppercased() {
        case "NBA": return "NBA desks usually show \(nbaPricedLegRange) distinct priced legs per full slate depending on tier."
        case "WNBA": return "WNBA runs slightly tighter boards — \(wnbaPricedLegRange) typical priced legs."
        case "NFL": return "NFL handles the widest prop surface — \(nflPricedLegRange) priced legs on busy Sundays."
        case "MLB": return "MLB is pitcher/batter skewed — \(mlbPricedLegRange) priced legs per slate is normal."
        default: return "Use Standard tier for balanced depth; Core saves Odds API batches."
        }
    }
}

/// High-signal markets to highlight in UI chips (subset of Odds API keys).
struct ElitePropMarketLanes {
    let sport: String
    let primary: [String]
    let secondary: [String]
    let avgBatchHint: String

    static func forSport(_ raw: String) -> ElitePropMarketLanes {
        let s = raw.uppercased()
        switch s {
        case "NBA", "WNBA":
            return ElitePropMarketLanes(
                sport: s,
                primary: ["Pts", "Rebs", "Asts", "3PM", "PRA"],
                secondary: ["Stl", "Blk", "DD", "TD"],
                avgBatchHint: s == "WNBA" ? PropSlateNorms.wnbaPricedLegRange : PropSlateNorms.nbaPricedLegRange
            )
        case "NFL":
            return ElitePropMarketLanes(
                sport: s,
                primary: ["Pass Yds", "Pass TD", "Rush Yds", "Rec", "Rec Yds"],
                secondary: ["Anytime TD", "INT", "Att", "Longest"],
                avgBatchHint: PropSlateNorms.nflPricedLegRange
            )
        case "MLB":
            return ElitePropMarketLanes(
                sport: s,
                primary: ["Hits", "HR", "Ks", "TB", "ER"],
                secondary: ["RBIs", "Runs", "Outs", "Walks"],
                avgBatchHint: PropSlateNorms.mlbPricedLegRange
            )
        default:
            return ElitePropMarketLanes(
                sport: s,
                primary: ["Main lines", "Player"],
                secondary: ["Alt", "Game"],
                avgBatchHint: "—"
            )
        }
    }
}

/// Maps Odds API market keys to short UI labels for filters.
enum PropMarketKeyDisplay {
    static func label(for key: String?) -> String {
        guard let k = key?.lowercased(), !k.isEmpty else { return "Prop" }
        let map: [String: String] = [
            "player_points": "PTS",
            "player_rebounds": "REB",
            "player_assists": "AST",
            "player_threes": "3PM",
            "player_blocks": "BLK",
            "player_steals": "STL",
            "player_turnovers": "TO",
            "player_points_rebounds_assists": "PRA",
            "player_pass_yds": "PASS YDS",
            "player_pass_tds": "PASS TD",
            "player_rush_yds": "RUSH",
            "player_receptions": "REC",
            "player_reception_yds": "REC YDS",
            "player_anytime_td": "ANY TD",
            "batter_hits": "HITS",
            "batter_home_runs": "HR",
            "pitcher_strikeouts": "K's",
            "pitcher_earned_runs": "ER",
        ]
        return map[k] ?? k.replacingOccurrences(of: "_", with: " ").uppercased()
    }
}

// MARK: - Tier guidance (client-side copy; server is source of truth via `/ops/dashboard`)

enum OddsPropTierCopy {
    static let core = "Lowest batch count — main scoring & usage markets only."
    static let standard = "Balanced retail depth (default). Strong coverage without every alt line."
    static let full = "Maximum configured markets — highest Odds API payload per event."
}
