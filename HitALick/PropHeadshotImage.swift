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

    static func uiAvatarURL(name: String) -> URL? {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let q = n.isEmpty ? "Player" : n
        let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "Player"
        return URL(string: "https://ui-avatars.com/api/?name=\(enc)&size=192&background=0a1227&color=7ef9d5&bold=true&font-size=0.33")
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

    static func resolvedURL(sport: String, leg: PlayerProp) -> URL? {
        if let h = leg.headshot?.trimmingCharacters(in: .whitespaces), let u = URL(string: h) {
            return u
        }
        if let u = espnHeadshotURL(sport: sport, espnAthleteId: leg.espnAthleteId) {
            return u
        }
        return uiAvatarURL(name: playerDisplayName(from: leg))
    }
}

// MARK: - Async image with graceful fallback

struct PropPlayerHeadshot: View {
    let sport: String
    let leg: PlayerProp
    @State private var failed = false

    var body: some View {
        let name = PropHeadshotResolver.playerDisplayName(from: leg)
        Group {
            if let url = PropHeadshotResolver.resolvedURL(sport: sport, leg: leg), !failed {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().scaledToFill()
                    case .failure:
                        fallbackInitials(name: name)
                            .onAppear { failed = true }
                    case .empty:
                        ZStack {
                            Color.white.opacity(0.08)
                            ProgressView().tint(.cyan)
                        }
                    @unknown default:
                        fallbackInitials(name: name)
                    }
                }
            } else {
                fallbackInitials(name: name)
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

    private func fallbackInitials(name: String) -> some View {
        let initials = name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined()
        return ZStack {
            LinearGradient(
                colors: [Color.purple.opacity(0.75), Color.cyan.opacity(0.55)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Text(initials.isEmpty ? "P" : initials.uppercased())
                .font(.system(size: 15, weight: .heavy))
                .foregroundColor(.white)
        }
    }
}
