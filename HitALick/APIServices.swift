import Foundation

// MARK: - Models

struct Player: Identifiable, Decodable {
    var id: String { playerId }
    let playerId: String
    let name: String
    let team: String
    let position: String
    /// Present when `/players` returns a URL; optional so decode never fails on partial payloads.
    let headshot: String?
}

struct Game: Decodable, Identifiable {
    var id: String { "\(sport ?? "na")-\(homeTeam)-\(awayTeam)-\(date)" }
    let date: String
    let time: String
    let homeTeam: String
    let awayTeam: String
    let odds: String
    let venue: String
    let sport: String?
    let gameId: String?
    let status: String?
    let state: String?
    let period: Int?
    let clock: String?
    let scoreline: String?
    let possession: String?
    let baseState: String?
    let redZone: Bool?
}

struct GamesEnvelope: Decodable {
    let sport: String?
    let count: Int?
    let games: [Game]
}

// MARK: - Props

/// Matches the data your `/props` Lambda returns:
/// { count: Int, props: [...], coverage?: ... }
struct PropsResponse: Decodable {
    let count: Int
    let props: [Prop]
}

/// Full `/props` payload for dashboard + diagnostics (optional fields ignored if missing).
struct PropsSnapshotEnvelope: Decodable {
    let sport: String?
    let mode: String?
    let count: Int?
    let totalPlayerProps: Int?
    let source: String?
    let warning: String?
    let generatedAt: String?
    let props: [Prop]
    let coverage: PropsCoverageBlock?
    let reliability: PropsReliabilityBlock?
}

struct PropsCoverageBlock: Decodable {
    let windowDays: Int?
    let propMarketTier: String?
    let totalPlayerProps: Int?
    let eventsWithPlayerProps: Int?
    let eventCount: Int?
    let deletedExpiredProps: Int?
    let cacheTtlSeconds: Int?
}

struct PropsReliabilityBlock: Decodable {
    let reliabilityAvg: Int?
    let sourceConfidenceDecayAvg: Double?
}

// MARK: - Ops desk (`/ops/dashboard`)

struct OpsDashboardResponse: Decodable {
    let ok: Bool?
    let generatedAt: String?
    let env: OpsEnvBlock?
    let marketsBySport: [String: [String]]?
    let typicalPricedLegsPerSlateRetail: [String: String]?
    let notes: [String]?
}

struct OpsEnvBlock: Decodable {
    let oddsApiKeyPresent: Bool?
    let rapidApiConfigured: Bool?
    let activePropMarketTier: String?
}

/// Public `/status` fallback when `/ops/dashboard` requires PIN / owner auth.
private struct PublicStatusResponse: Decodable {
    let provider: PublicProvider?
}

private struct PublicProvider: Decodable {
    let oddsApiConfigured: Bool?
    let rapidApiConfigured: Bool?
}

extension PropsSnapshotEnvelope {
    /// When full envelope decoding fails (schema drift), still surface props from legacy `{ count, props }`.
    init(fallbackFrom response: PropsResponse) {
        sport = nil
        mode = nil
        count = response.count
        totalPlayerProps = nil
        source = nil
        warning = nil
        generatedAt = nil
        props = response.props
        coverage = nil
        reliability = nil
    }
}

struct Prop: Identifiable, Decodable {
    // Raw fields from backend
    let sport: String
    let matchup: String
    let spread: String
    let moneyline: String
    let total: String
    let date: String
    let availableBooks: [String]?
    let preferredBook: PreferredBook?
    let playerProps: [PlayerProp]?
    let confidence: Double?
    let confidenceBand: String?
    let analytics: PropAnalytics?
    let commenceTime: String?
    let eventId: String?
    let source: String?
    let tags: [String]?

    /// When backend sends explicit clock string (rare); otherwise derived from `commenceTime`.
    private let timeField: String?

    enum CodingKeys: String, CodingKey {
        case sport, matchup, spread, moneyline, total, date
        case availableBooks, preferredBook, playerProps, confidence, confidenceBand, analytics
        case commenceTime, eventId, source, tags
        case timeField = "time"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sport = try c.decode(String.self, forKey: .sport)
        matchup = try c.decode(String.self, forKey: .matchup)
        spread = try c.decodeIfPresent(String.self, forKey: .spread) ?? "N/A"
        moneyline = try c.decodeIfPresent(String.self, forKey: .moneyline) ?? "N/A"
        total = try c.decodeIfPresent(String.self, forKey: .total) ?? "N/A"
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        availableBooks = try c.decodeIfPresent([String].self, forKey: .availableBooks)
        preferredBook = try c.decodeIfPresent(PreferredBook.self, forKey: .preferredBook)
        playerProps = try c.decodeIfPresent([PlayerProp].self, forKey: .playerProps)
        confidence = try c.decodeIfPresent(Double.self, forKey: .confidence)
        confidenceBand = try c.decodeIfPresent(String.self, forKey: .confidenceBand)
        analytics = try c.decodeIfPresent(PropAnalytics.self, forKey: .analytics)
        commenceTime = try c.decodeIfPresent(String.self, forKey: .commenceTime)
        eventId = try c.decodeIfPresent(String.self, forKey: .eventId)
        source = try c.decodeIfPresent(String.self, forKey: .source)
        tags = try c.decodeIfPresent([String].self, forKey: .tags)
        timeField = try c.decodeIfPresent(String.self, forKey: .timeField)
    }

    // Identifiable — stable across daily refreshes when event id exists.
    var id: String {
        if let eid = eventId, !eid.isEmpty { return "\(sport.lowercased())_\(eid)" }
        let ct = commenceTime ?? ""
        return "\(sport)_\(matchup)_\(date)_\(ct)"
    }

    // ---- Compatibility helpers for existing UI ----

    /// Used in the UI as `prop.player` – show matchup text here.
    var player: String { matchup }

    /// Used in the UI as `prop.type` – generic description.
    var type: String { "Line" }

    /// Used in UI as numeric prediction; best guess from `total` number.
    var prediction: Double {
        let digits = total.filter { "0123456789.".contains($0) }
        return Double(digits) ?? 0
    }

    /// Not scraped yet – keep empty for now.
    var trend: String { "" }

    var time: String {
        if let t = timeField, !t.trimmingCharacters(in: .whitespaces).isEmpty { return t }
        return PropFormatters.shortTime(fromISO: commenceTime) ?? "00:00"
    }

    /// Badge shown in UI – sport code.
    var badge: String { sport.uppercased() }

    var isLiveOddsSource: Bool {
        let s = (source ?? "").lowercased()
        return s == "odds_api" || s == "rapidapi_odds"
    }

    var eventStartDate: Date? {
        PropFormatters.eventDate(dateYmd: date, commenceISO: commenceTime)
    }

    var sportsbookSymbols: String {
        let map: [String: String] = [
            "fanduel": "FD",
            "draftkings": "DK",
            "betmgm": "MGM",
            "williamhill_us": "CZR",
            "caesars": "CZR",
            "pointsbetus": "PB",
            "espnbet": "ESPN",
            "prizepicks": "PP",
            "underdog": "UD",
            "pick6": "P6",
            "betr_us_dfs": "BETR",
        ]
        let symbols = (availableBooks ?? [])
            .prefix(10)
            .map { map[$0.lowercased()] ?? $0.uppercased() }
        return symbols.isEmpty ? "No books cached" : symbols.joined(separator: " • ")
    }

    var preferredBookName: String {
        preferredBook?.bookmakerName ?? "FanDuel + major books"
    }

    var confidencePercent: Int {
        Int((confidence ?? 55).rounded())
    }

    var confidenceTint: String {
        let band = (confidenceBand ?? "").lowercased()
        if band == "green" || confidencePercent >= 72 { return "green" }
        if band == "yellow" || confidencePercent >= 55 { return "yellow" }
        return "red"
    }
}

struct PreferredBook: Decodable {
    let bookmakerKey: String?
    let bookmakerName: String?
}

struct PlayerPropBookQuote: Decodable {
    let bookKey: String?
    let bookName: String?
    let odds: Int?
}

struct PlayerProp: Decodable, Identifiable {
    var id: String {
        let m = market ?? "market"
        let l = label ?? "label"
        let s = side ?? "side"
        let lineText = line.map { String($0) } ?? "na"
        return "\(m)-\(l)-\(s)-\(lineText)"
    }
    let market: String?
    let label: String?
    let side: String?
    let line: Double?
    let odds: Int?
    let bookKey: String?
    let bookName: String?
    /// Resolved on server when possible; client still derives from `label` if nil.
    let playerName: String?
    let headshot: String?
    let espnAthleteId: String?
    let synthetic: Bool?
    /// Per-leg model confidence when the API provides it; otherwise UI falls back to game-level `Prop.confidence`.
    let confidence: Double?
    let projected: Bool?
    /// All books offering this same line (merged on server). Primary `bookKey` / `odds` is display priority.
    let bookQuotes: [PlayerPropBookQuote]?
}

enum PropFormatters {
    static func shortTime(fromISO iso: String?) -> String? {
        guard let iso, !iso.isEmpty else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var d = f.date(from: iso)
        if d == nil {
            f.formatOptions = [.withInternetDateTime]
            d = f.date(from: iso)
        }
        guard let date = d else { return nil }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US_POSIX")
        out.timeZone = TimeZone.current
        out.dateFormat = "h:mm a"
        return out.string(from: date)
    }

    static func eventDate(dateYmd: String, commenceISO: String?) -> Date? {
        if let iso = commenceISO, !iso.isEmpty {
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var d = f.date(from: iso)
            if d == nil {
                f.formatOptions = [.withInternetDateTime]
                d = f.date(from: iso)
            }
            if let d { return d }
        }
        let raw = String(dateYmd.prefix(10))
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone.current
        df.dateFormat = "yyyy-MM-dd"
        return df.date(from: raw)
    }
}

struct PropAnalytics: Decodable {
    let edgeCount: Int?
    let reliabilityScore: Int?
    let sourceConfidenceDecay: Double?
    let steamFlag: Bool?
    let topEdges: [PropEdge]?
}

struct PropEdge: Decodable, Identifiable {
    var id: String {
        "\(label ?? "player")-\(market ?? "market")-\(side ?? "side")-\(line ?? 0)-\(bestOdds ?? 0)"
    }
    let market: String?
    let label: String?
    let side: String?
    let line: Double?
    let bestBook: String?
    let bestOdds: Int?
    let fairOdds: Int?
    let edgePct: Double?
}

// MARK: - Game / Entity Stats

struct GameStat: Identifiable, Codable {
    var id: String { "\(date)|\(opponent)" }
    let date: String
    let opponent: String
    let result: String
    let points: Int?
    let assists: Int?
    let rebounds: Int?
    let minutes: Double?
    let venue: String?
}

struct EntityStat: Identifiable, Codable {
    var id: String { "\(name)|\(playerId ?? name)" }
    let name: String
    let playerId: String?
    let headshot: String?
    let position: String?
    let team: String?
    let summary: StatSummary?
    let statHistory: [GameStat]
}

struct StatSummary: Codable {
    let samples: Int?
    let averages: SummaryAverages?
}

struct SummaryAverages: Codable {
    let points: Double?
    let assists: Double?
    let rebounds: Double?
    let minutes: Double?
}

struct EntityStatsEnvelope: Decodable {
    let sport: String?
    let mode: String?
    let count: Int?
    let rows: [EntityStat]
}

// MARK: - Dummy Fallback

let dummyEntityStats: [EntityStat] = [
    EntityStat(
        name: "John Doe",
        playerId: "123",
        headshot: "https://example.com/headshot.jpg",
        position: "SG",
        team: "Demo Team",
        summary: nil,
        statHistory: [
            GameStat(date: "2025-10-20", opponent: "LAL", result: "W", points: 24, assists: 7, rebounds: 5, minutes: 34, venue: "home"),
            GameStat(date: "2025-10-18", opponent: "BOS", result: "L", points: 19, assists: 4, rebounds: 6, minutes: 31, venue: "away")
        ]
    )
]

// MARK: - Live Detail

struct LiveDetail: Decodable {
    let playByPlay: [[String: String]]
    let stats: [String: [[String]]]
    let timeoutInfo: [String]
    let starters: [String]
    let location: String
    let liveScore: [String]
    let injuries: [String]
    let possession: String
    let onField: [String]
    let baseInfo: [String]
    let fouls: [[String: String]]
    let freeThrows: [[String: String]]
}

// MARK: - API SERVICES

class APIServices {
    static let shared = APIServices()
    private init() {}

    /// Cloud Run URL for the `api` HTTPS function. Default in `APIConfig`; override with UserDefaults `hitalick_api_base`.
    var baseURL: String { APIConfig.baseURL }

    private let urlSession: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.waitsForConnectivity = true
        cfg.timeoutIntervalForRequest = 45
        cfg.timeoutIntervalForResource = 120
        return URLSession(configuration: cfg)
    }()

    private func dataWithStatus(from url: URL) async throws -> (Data, Int) {
        let (data, response) = try await urlSession.data(from: url)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 200
        return (data, status)
    }

    // MARK: Fetch Entity Stats (from /playerStats or /teamStats)

    func fetchEntityStats(for sport: String, mode: String, completion: @escaping ([EntityStat]) -> Void) {
        let route = mode.lowercased() == "player" ? "playerStats" : "teamStats"
        let isAll = sport.lowercased() == "all"
        let limit = isAll ? "&limit=800" : ""
        let urlString = "\(baseURL)/\(route)?sport=\(sport.lowercased())\(limit)"

        guard let url = URL(string: urlString) else {
            print("❌ Invalid URL for stats")
            completion(dummyEntityStats)
            return
        }

        urlSession.dataTask(with: url) { data, _, error in
            if let error = error {
                print("❌ Stats API Error:", error.localizedDescription)
                completion(dummyEntityStats)
                return
            }

            guard let data = data else {
                print("⚠️ No stats data returned")
                completion(dummyEntityStats)
                return
            }

            do {
                if let envelope = try? JSONDecoder().decode(EntityStatsEnvelope.self, from: data) {
                    let decoded = envelope.rows
                    print("✅ Decoded \(decoded.count) entity stats (envelope)")
                    completion(decoded.isEmpty ? dummyEntityStats : decoded)
                    return
                }
                let decoded = try JSONDecoder().decode([EntityStat].self, from: data)
                print("✅ Decoded \(decoded.count) entity stats")
                completion(decoded.isEmpty ? dummyEntityStats : decoded)
            } catch {
                print("❌ Stats decode error:", error)
                completion(dummyEntityStats)
            }
        }.resume()
    }

    // MARK: Fetch Players

    func fetchPlayers(for sport: String, completion: @escaping ([Player]) -> Void) {
        let isAll = sport.lowercased() == "all"
        let limit = isAll ? "&limit=1200" : ""
        let urlString = "\(baseURL)/players?sport=\(sport.lowercased())\(limit)"
        guard let url = URL(string: urlString) else { completion([]); return }

        urlSession.dataTask(with: url) { data, _, error in
            if let error = error {
                print("❌ Player API Error:", error.localizedDescription)
                completion([])
                return
            }

            guard let data = data else {
                print("⚠️ No player data returned")
                completion([])
                return
            }

            do {
                let decoded = try JSONDecoder().decode([Player].self, from: data)
                print("✅ Loaded \(decoded.count) players.")
                completion(decoded)
            } catch {
                print("❌ Player decode error:", error)
                completion([])
            }
        }.resume()
    }

    // MARK: Fetch Games

    func fetchGames(for sport: String, completion: @escaping (Result<[Game], Error>) -> Void) {
        let urlString = "\(baseURL)/games?sport=\(sport.lowercased())"
        guard let url = URL(string: urlString) else {
            completion(.failure(NSError(domain: "Invalid URL", code: 400)))
            return
        }

        urlSession.dataTask(with: url) { data, _, error in
            if let error = error {
                completion(.failure(error))
                return
            }

            guard let data = data else {
                completion(.failure(NSError(domain: "No data", code: 500)))
                return
            }

            do {
                if let envelope = try? JSONDecoder().decode(GamesEnvelope.self, from: data) {
                    completion(.success(envelope.games))
                    return
                }
                let decoded = try JSONDecoder().decode([Game].self, from: data)
                completion(.success(decoded))
            } catch {
                print("❌ Games decode error:", error)
                completion(.failure(error))
            }
        }.resume()
    }

    // MARK: Fetch Props

    func fetchProps(for sport: String, completion: @escaping (Result<[Prop], Error>) -> Void) {
        // Match web "Max Coverage": request full-event player-prop matrices for every sport, not only sport=all.
        let primaryCoverage = "&allEventProps=1&includeBooks=0&windowDays=3"
        let primaryUrlString = "\(baseURL)/props?sport=\(sport.lowercased())\(primaryCoverage)"
        let fallbackUrlString = "\(baseURL)/props?sport=\(sport.lowercased())&includeBooks=0&windowDays=3"
        guard let primaryUrl = URL(string: primaryUrlString), let fallbackUrl = URL(string: fallbackUrlString) else {
            completion(.failure(NSError(domain: "Invalid URL", code: 400)))
            return
        }

        urlSession.dataTask(with: primaryUrl) { data, response, error in
            if let error = error {
                print("❌ Props error:", error)
                completion(.failure(error))
                return
            }

            guard let data = data else {
                completion(.failure(NSError(domain: "No data", code: 500)))
                return
            }

            let status = (response as? HTTPURLResponse)?.statusCode ?? 200
            let primaryLooksBad = status >= 500 || String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) == "Internal Server Error"

            do {
                // Decode wrapper { count, props: [...] }
                let wrapper = try JSONDecoder().decode(PropsResponse.self, from: data)
                print("✅ Decoded \(wrapper.count) props")
                completion(.success(wrapper.props))
            } catch {
                if primaryLooksBad {
                    self.urlSession.dataTask(with: fallbackUrl) { data2, _, error2 in
                        if let error2 = error2 {
                            completion(.failure(error2))
                            return
                        }
                        guard let data2 = data2 else {
                            completion(.failure(NSError(domain: "No data", code: 500)))
                            return
                        }
                        do {
                            let wrapper2 = try JSONDecoder().decode(PropsResponse.self, from: data2)
                            print("✅ Decoded \(wrapper2.count) props (fallback query)")
                            completion(.success(wrapper2.props))
                        } catch {
                            print("❌ Props decode error (fallback):", error)
                            completion(.failure(error))
                        }
                    }.resume()
                    return
                }
                print("❌ Props decode error:", error)
                completion(.failure(error))
            }
        }.resume()
    }

    /// Full envelope for Elite Desk / dashboard (coverage, source, warnings).
    func fetchPropsSnapshot(for sport: String, completion: @escaping (Result<PropsSnapshotEnvelope, Error>) -> Void) {
        let primaryCoverage = "&allEventProps=1&includeBooks=0&windowDays=3"
        let primaryUrlString = "\(baseURL)/props?sport=\(sport.lowercased())\(primaryCoverage)"
        let fallbackUrlString = "\(baseURL)/props?sport=\(sport.lowercased())&includeBooks=0&windowDays=3"
        guard let primaryUrl = URL(string: primaryUrlString), let fallbackUrl = URL(string: fallbackUrlString) else {
            completion(.failure(NSError(domain: "Invalid URL", code: 400)))
            return
        }

        urlSession.dataTask(with: primaryUrl) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            guard let data = data else {
                completion(.failure(NSError(domain: "No data", code: 500)))
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 200
            let primaryLooksBad = status >= 500 || String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) == "Internal Server Error"
            do {
                let env = try JSONDecoder().decode(PropsSnapshotEnvelope.self, from: data)
                completion(.success(env))
            } catch {
                do {
                    let legacy = try JSONDecoder().decode(PropsResponse.self, from: data)
                    completion(.success(PropsSnapshotEnvelope(fallbackFrom: legacy)))
                } catch {
                    if primaryLooksBad {
                        self.urlSession.dataTask(with: fallbackUrl) { data2, _, error2 in
                            if let error2 = error2 {
                                completion(.failure(error2))
                                return
                            }
                            guard let data2 = data2 else {
                                completion(.failure(NSError(domain: "No data", code: 500)))
                                return
                            }
                            do {
                                let env2 = try JSONDecoder().decode(PropsSnapshotEnvelope.self, from: data2)
                                completion(.success(env2))
                            } catch {
                                do {
                                    let legacy2 = try JSONDecoder().decode(PropsResponse.self, from: data2)
                                    completion(.success(PropsSnapshotEnvelope(fallbackFrom: legacy2)))
                                } catch {
                                    completion(.failure(error))
                                }
                            }
                        }.resume()
                        return
                    }
                    completion(.failure(error))
                }
            }
        }.resume()
    }

    // MARK: Fetch Teams

    func fetchTeams(for sport: String, completion: @escaping ([String]) -> Void) {
        let urlString = "\(baseURL)/teams?sport=\(sport.lowercased())"
        guard let url = URL(string: urlString) else { completion([]); return }

        urlSession.dataTask(with: url) { data, _, _ in
            guard let data = data else { completion([]); return }

            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let teams = json["teams"] as? [String] {
                completion(teams)
            } else {
                completion([])
            }
        }.resume()
    }

    // MARK: Fetch Live Detail

    func fetchLiveDetail(sport: String, gameId: String, completion: @escaping (LiveDetail?) -> Void) {
        let urlString = "\(baseURL)/liveGame?league=\(sport.lowercased())&gameId=\(gameId)"
        guard let url = URL(string: urlString) else { completion(nil); return }

        urlSession.dataTask(with: url) { data, _, _ in
            guard let data = data else { completion(nil); return }

            do {
                let decoded = try JSONDecoder().decode(LiveDetail.self, from: data)
                completion(decoded)
            } catch {
                print("❌ Live detail error:", error)
                completion(nil)
            }
        }.resume()
    }
}

// MARK: - Async / await (preferred for SwiftUI `.task`)

extension APIServices {
    func fetchPropsSnapshot(for sport: String) async throws -> PropsSnapshotEnvelope {
        try await withCheckedThrowingContinuation { continuation in
            fetchPropsSnapshot(for: sport) { continuation.resume(with: $0) }
        }
    }

    func fetchProps(for sport: String) async throws -> [Prop] {
        try await withCheckedThrowingContinuation { continuation in
            fetchProps(for: sport) { continuation.resume(with: $0) }
        }
    }

    func fetchOpsDashboard() async throws -> OpsDashboardResponse {
        guard let url = URL(string: "\(baseURL)/ops/dashboard") else {
            throw NSError(domain: "HitAPI", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid ops URL"])
        }
        let (data, status) = try await dataWithStatus(from: url)
        if (200 ... 299).contains(status) {
            return try JSONDecoder().decode(OpsDashboardResponse.self, from: data)
        }

        // If ops dashboard needs PIN/owner auth, fallback to public /status so Desk stays usable.
        if status == 401 || status == 403 {
            guard let statusUrl = URL(string: "\(baseURL)/api/status") else {
                throw NSError(domain: "HitAPI", code: status, userInfo: [NSLocalizedDescriptionKey: "Ops requires PIN/auth"])
            }
            let (sData, sCode) = try await dataWithStatus(from: statusUrl)
            guard (200 ... 299).contains(sCode) else {
                throw NSError(domain: "HitAPI", code: status, userInfo: [NSLocalizedDescriptionKey: "Ops requires PIN/auth"])
            }
            if let pub = try? JSONDecoder().decode(PublicStatusResponse.self, from: sData) {
                return OpsDashboardResponse(
                    ok: true,
                    generatedAt: nil,
                    env: OpsEnvBlock(
                        oddsApiKeyPresent: pub.provider?.oddsApiConfigured,
                        rapidApiConfigured: pub.provider?.rapidApiConfigured,
                        activePropMarketTier: nil
                    ),
                    marketsBySport: nil,
                    typicalPricedLegsPerSlateRetail: nil,
                    notes: ["Ops dashboard is PIN-protected. Showing public provider status fallback in app."]
                )
            }
            throw NSError(domain: "HitAPI", code: status, userInfo: [NSLocalizedDescriptionKey: "Ops requires PIN/auth"])
        }

        throw NSError(domain: "HitAPI", code: status, userInfo: [NSLocalizedDescriptionKey: "HTTP \(status)"])
    }

    func fetchBillingEntitlement(uid: String, token: String) async throws -> BillingEntitlementPayload? {
        let url = URL(string: "\(baseURL)/api/billing/entitlements/\(uid)")!
        var request = URLRequest(url: url)
        request.hitApplySessionHeaders(firebaseIdToken: token)
        let (data, _) = try await urlSession.data(for: request)
        let decoded = try JSONDecoder().decode(BillingEntitlementResponse.self, from: data)
        return decoded.entitlement
    }
}

// MARK: - Safe Array

extension Array {
    subscript(safe index: Int) -> Element? {
        return indices.contains(index) ? self[index] : nil
    }
}
