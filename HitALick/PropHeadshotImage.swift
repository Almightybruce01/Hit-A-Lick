import SwiftUI

// MARK: - Headshot resolution (server sends URL; client fallback for older payloads)

enum PropHeadshotResolver {
    private static func espnLeague(for sport: String) -> String {
        switch sport.lowercased() {
        case "nba": return "nba"
        case "wnba": return "wnba"
        case "nfl": return "nfl"
        case "mlb": return "mlb"
        default: return "nba"
        }
    }

    static func espnHeadshotURL(sport: String, espnAthleteId: String?) -> URL? {
        guard let id = espnAthleteId?.trimmingCharacters(in: .whitespaces), !id.isEmpty, id.unicodeScalars.allSatisfy({ CharacterSet.decimalDigits.contains($0) }) else {
            return nil
        }
        let league = espnLeague(for: sport)
        return URL(string: "https://a.espncdn.com/i/headshots/\(league)/players/full/\(id).png")
    }

    static func playerDisplayName(from leg: PlayerProp) -> String {
        if let n = leg.playerName?.trimmingCharacters(in: .whitespaces), !n.isEmpty { return n }
        return extractNameFromLabel(leg.label)
    }

    /// Odds API labels often look like "LeBron James 27.5" or "Over 0.5".
    static func extractNameFromLabel(_ label: String?) -> String {
        guard let label = label?.trimmingCharacters(in: .whitespaces), !label.isEmpty else {
            return "Player"
        }
        var noOu = label
        if let r = label.range(of: " over", options: [.caseInsensitive, .backwards]) {
            noOu = String(label[..<r.lowerBound]).trimmingCharacters(in: .whitespaces)
        } else if let r = label.range(of: " under", options: [.caseInsensitive, .backwards]) {
            noOu = String(label[..<r.lowerBound]).trimmingCharacters(in: .whitespaces)
        }
        let parts = noOu.split(separator: " ")
        var out: [String] = []
        for p in parts {
            if p.first?.isNumber == true { break }
            if p.lowercased() == "o/u" { break }
            out.append(String(p))
        }
        let name = out.joined(separator: " ")
        return name.isEmpty ? noOu : name
    }

    /// Real CDN URLs only — no generated avatars; UI uses `EliteGreyMediaSlot` when nil.
    static func resolvedURL(sport: String, leg: PlayerProp) -> URL? {
        if let h = leg.headshot?.trimmingCharacters(in: .whitespaces), !h.isEmpty, let u = URL(string: h) {
            let s = u.scheme?.lowercased() ?? ""
            if s == "http" || s == "https" { return u }
        }
        return espnHeadshotURL(sport: sport, espnAthleteId: leg.espnAthleteId)
    }
}

// MARK: - Async image with graceful fallback

struct PropPlayerHeadshot: View {
    let sport: String
    let leg: PlayerProp

    var body: some View {
        let name = PropHeadshotResolver.playerDisplayName(from: leg)
        Group {
            if let url = PropHeadshotResolver.resolvedURL(sport: sport, leg: leg) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().scaledToFill()
                    case .failure:
                        EliteGreyMediaSlot(size: 46, cornerFraction: 12 / 46)
                    case .empty:
                        EliteGreyMediaSlot(size: 46, cornerFraction: 12 / 46)
                    @unknown default:
                        EliteGreyMediaSlot(size: 46, cornerFraction: 12 / 46)
                    }
                }
            } else {
                EliteGreyMediaSlot(size: 46, cornerFraction: 12 / 46)
            }
        }
        .frame(width: 46, height: 46)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.white.opacity(0.22), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.35), radius: 6, y: 3)
        .accessibilityLabel("Player headshot for \(name)")
    }
}
