import SwiftUI
import FirebaseAuth
#if canImport(UIKit)
import UIKit
#endif

struct AIPick: Identifiable, Decodable {
    var id: String { "\(label)-\(book)-\(odds)" }
    let label: String
    let sport: String
    let type: String
    let book: String
    let odds: Int
    let confidence: Double
}

struct AIPicksResponse: Decodable {
    let picks: [AIPick]
}

struct AIParlayResponse: Decodable {
    let legCount: Int
    let parlayDecimal: Double
    let projectedReturn: Double?
    let projectedProfit: Double?
}

struct AIQuotaResponse: Decodable {
    let unlimited: Bool?
    let used: Int?
    let limit: Int?
    let remaining: Int?
    let monthKey: String?
    let staff: String?
    let freeMonthly: Int?
    let locked: Bool?
    let reason: String?
}

struct AICopilotResponse: Decodable {
    let sport: String?
    let suggestedFilters: CopilotFilters?
    let coachingNotes: [String]?
    let disclaimer: String?

    struct CopilotFilters: Decodable {
        let minConfidence: Int?
        let maxPicks: Int?
    }
}

private struct AIPlayBookQuoteUI: Identifiable {
    let id: String
    let abbrev: String
    let odds: Int
    let okPrice: Bool
}

private struct AIPlayOfTheDayRow: Identifiable {
    let id: String
    let propSentence: String
    let sport: String
    let matchup: String
    let quotes: [AIPlayBookQuoteUI]
    let confidencePct: Int
}

private struct AIPlaysQuoteAPI: Decodable {
    let bookKey: String?
    let odds: Int?
    let okPrice: Bool?
}

private struct AIPlaysOfDayAPIResponse: Decodable {
    let ok: Bool?
    let picks: [AIPlaysOfDayAPILeg]?
    let dateKey: String?
}

private struct AIPlaysOfDayAPILeg: Decodable {
    let label: String?
    let sport: String?
    let matchup: String?
    let line: Double?
    let side: String?
    let odds: Int?
    let bookKey: String?
    let confidence: Int?
    let propSentence: String?
    let quotes: [AIPlaysQuoteAPI]?
}

struct AILab: View {
    @State private var sport = "nba"
    @State private var minConfidence = 55.0
    @State private var maxPicks = 8
    @State private var preferredBooks = ""
    @State private var picks: [AIPick] = []
    @State private var cart: [AIPick] = []
    @State private var stake = "20"
    @State private var statusText = "Set filters and generate AI picks."
    @State private var isError = false
    @State private var isGenerating = false
    @State private var isCalculating = false
    @State private var copilotMessage = ""
    @State private var copilotReply: AICopilotResponse?
    @State private var isCopilotLoading = false
    @State private var quotaText = ""
    @State private var aiPlaysRows: [AIPlayOfTheDayRow] = []
    @State private var aiPlaysLoading = false
    @State private var aiPlaysStatus = ""
    @State private var aiPlaysSnapshotNote = ""
    @State private var billingEntitlement: BillingEntitlementPayload?
    @State private var billingLoaded = false
    @State private var aiMeterExhausted = false
    @AppStorage("hitalick_ai_cart_touch") private var cartLastTouchEpoch: Double = 0

    private let sports = ["nba", "nfl", "mlb", "wnba"]
    private let cartStaleSeconds: TimeInterval = 48 * 3600
    private var baseURL: String { APIConfig.baseURL }

    private var websiteAppUnlocked: Bool {
        billingEntitlement?.effectiveHasAppAccess == true
    }

    private var aiUnlimitedEntitlement: Bool {
        billingEntitlement?.effectiveAiUnlimited == true
    }

    var body: some View {
        ZStack {
            EliteBackground()

            ScrollView {
                VStack(spacing: 12) {
                    ElitePanel {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("AI plays of the day")
                                .font(.title3.bold())
                                .foregroundColor(.white)
                            Text("Top 3 player props from the full slate — confidence ≥60%, priced book, American odds no worse than -190 (plus money OK).")
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.78))
                            if !aiPlaysSnapshotNote.isEmpty {
                                Text(aiPlaysSnapshotNote)
                                    .font(.caption2)
                                    .foregroundColor(.cyan.opacity(0.88))
                            }
                            if aiPlaysLoading {
                                ProgressView()
                                    .tint(.orange)
                            } else if !aiPlaysStatus.isEmpty {
                                Text(aiPlaysStatus)
                                    .font(.caption)
                                    .foregroundColor(.red.opacity(0.9))
                            } else if aiPlaysRows.isEmpty {
                                Text("No qualifying legs yet. Open the Props board or refresh data — when live lines meet the filters they show here.")
                                    .font(.caption)
                                    .foregroundColor(.white.opacity(0.68))
                            } else {
                                ForEach(aiPlaysRows) { row in
                                    VStack(alignment: .leading, spacing: 8) {
                                        HStack(alignment: .top) {
                                            Text(row.propSentence)
                                                .font(.subheadline.weight(.semibold))
                                                .foregroundColor(.white)
                                                .fixedSize(horizontal: false, vertical: true)
                                            Spacer(minLength: 8)
                                            Text("\(row.confidencePct)%")
                                                .font(.caption.weight(.bold))
                                                .foregroundColor(.green)
                                        }
                                        Text("\(row.sport) · \(row.matchup)")
                                            .font(.caption2)
                                            .foregroundColor(.white.opacity(0.72))
                                        Text("Books")
                                            .font(.caption2.weight(.bold))
                                            .foregroundColor(.white.opacity(0.55))
                                            .textCase(.uppercase)
                                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 8, alignment: .leading)], spacing: 8) {
                                            ForEach(row.quotes) { q in
                                                HStack(spacing: 6) {
                                                    Text(q.abbrev)
                                                        .font(.caption2.weight(.heavy))
                                                        .foregroundColor(.cyan)
                                                    Text(formatAmericanOdds(q.odds))
                                                        .font(.caption.weight(.bold))
                                                        .foregroundColor(q.okPrice ? Color.orange.opacity(0.98) : Color.yellow.opacity(0.92))
                                                }
                                                .padding(.horizontal, 10)
                                                .padding(.vertical, 6)
                                                .background(Color.black.opacity(0.38))
                                                .overlay(
                                                    RoundedRectangle(cornerRadius: 10)
                                                        .stroke(q.okPrice ? Color.white.opacity(0.12) : Color.yellow.opacity(0.35), lineWidth: 1)
                                                )
                                                .cornerRadius(10)
                                            }
                                        }
                                    }
                                    .padding(8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.black.opacity(0.28))
                                    .cornerRadius(10)
                                }
                            }
                        }
                    }
                    .frame(maxWidth: 520)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal)

                    ElitePanel {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("AI Picks Engine")
                                .font(.title3.bold())
                                .foregroundColor(.white)
                            if !quotaText.isEmpty {
                                Text(quotaText)
                                    .font(.caption.weight(.semibold))
                                    .foregroundColor(.cyan.opacity(0.95))
                            }
                            Text("Generate ranked picks from your filters and build a parlay instantly.")
                                .font(.subheadline)
                                .foregroundColor(.white.opacity(0.82))

                            Picker("Sport", selection: $sport) {
                                ForEach(sports, id: \.self) { s in
                                    Text(s.uppercased()).tag(s)
                                }
                            }
                            .pickerStyle(SegmentedPickerStyle())

                            HStack {
                                Text("Min Confidence \(Int(minConfidence))%")
                                    .font(.caption)
                                    .foregroundColor(.white.opacity(0.85))
                                Spacer()
                                Stepper("Max \(maxPicks)", value: $maxPicks, in: 3...20)
                                    .labelsHidden()
                            }
                            Slider(value: $minConfidence, in: 40...95, step: 1)
                                .tint(.orange)

                            TextField("Preferred books (draftkings,fanduel,...)", text: $preferredBooks)
                                .padding(10)
                                .background(Color.white.opacity(0.1))
                                .cornerRadius(10)
                                .foregroundColor(.white)

                            GlassPrimaryButton(title: isGenerating ? "Generating..." : "Generate AI Picks") {
                                generatePicks()
                            }
                            .disabled(isGenerating || aiMeterExhausted)
                        }
                    }
                    .padding(.horizontal)

                    ElitePanel {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("AI Bet Copilot")
                                .font(.title3.bold())
                                .foregroundColor(.white)
                            Text("Describe risk tolerance (safe vs aggressive). We return filter hints — not a ticket.")
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.78))
                            TextField("e.g. Conservative NBA, 2-leg parlay ideas", text: $copilotMessage, axis: .vertical)
                                .lineLimit(3...6)
                                .padding(10)
                                .background(Color.white.opacity(0.1))
                                .cornerRadius(10)
                                .foregroundColor(.white)
                            GlassPrimaryButton(title: isCopilotLoading ? "Thinking..." : "Ask Copilot") {
                                runCopilot()
                            }
                            .disabled(isCopilotLoading || aiMeterExhausted)
                            if let c = copilotReply {
                                VStack(alignment: .leading, spacing: 6) {
                                    if let notes = c.coachingNotes {
                                        ForEach(notes, id: \.self) { line in
                                            Text("• \(line)")
                                                .font(.caption)
                                                .foregroundColor(.cyan.opacity(0.92))
                                        }
                                    }
                                    if let f = c.suggestedFilters {
                                        Text("Suggested: min confidence \(f.minConfidence ?? 0)%, max picks \(f.maxPicks ?? 0)")
                                            .font(.caption2)
                                            .foregroundColor(.white.opacity(0.75))
                                    }
                                    if let d = c.disclaimer {
                                        Text(d)
                                            .font(.caption2)
                                            .foregroundColor(.white.opacity(0.55))
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal)

                    ElitePanel {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Generated Picks")
                                .font(.headline)
                                .foregroundColor(.white)
                            if isGenerating {
                                VStack(spacing: 8) {
                                    SkeletonBlock()
                                    SkeletonBlock()
                                }
                            } else if picks.isEmpty {
                                EmptyStateCard(
                                    title: "No AI Picks Yet",
                                    message: "Generate picks using your filters to populate this board."
                                )
                            } else {
                                ForEach(picks.prefix(12)) { pick in
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack {
                                            Text(pick.label)
                                                .font(.subheadline.weight(.semibold))
                                                .foregroundColor(.white)
                                            Spacer()
                                            Text("\(Int(pick.confidence))%")
                                                .font(.caption.weight(.bold))
                                                .foregroundColor(.green)
                                        }
                                        Text("\(pick.book) • \(pick.type.uppercased()) • \(pick.odds > 0 ? "+" : "")\(pick.odds)")
                                            .font(.caption)
                                            .foregroundColor(.white.opacity(0.8))
                                        Button("Add to Cart") {
                                            touchCart()
                                            cart.append(pick)
                                        }
                                        .font(.caption.weight(.semibold))
                                        .foregroundColor(.orange)
                                    }
                                    .padding(8)
                                    .background(Color.black.opacity(0.25))
                                    .cornerRadius(10)
                                }
                            }
                        }
                    }
                    .padding(.horizontal)

                    ElitePanel {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Parlay Cart")
                                .font(.headline)
                                .foregroundColor(.white)
                            if cart.isEmpty {
                                Text("Cart is empty.")
                                    .font(.caption)
                                    .foregroundColor(.white.opacity(0.7))
                            } else {
                                ForEach(cart.indices, id: \.self) { idx in
                                    HStack {
                                        Text(cart[idx].label)
                                            .font(.caption)
                                            .foregroundColor(.white)
                                            .lineLimit(2)
                                        Spacer()
                                        Button {
                                            touchCart()
                                            cart.remove(at: idx)
                                        } label: {
                                            Image(systemName: "trash")
                                                .foregroundColor(.red.opacity(0.9))
                                        }
                                    }
                                }
                            }

                            TextField("Stake", text: $stake)
                                .keyboardType(.decimalPad)
                                .padding(10)
                                .background(Color.white.opacity(0.1))
                                .cornerRadius(10)
                                .foregroundColor(.white)

                            GlassPrimaryButton(title: isCalculating ? "Calculating..." : "Calculate Parlay") {
                                calculateParlay()
                            }
                            .disabled(isCalculating || aiMeterExhausted)
                        }
                    }
                    .padding(.horizontal)

                    Text(statusText)
                        .font(.caption)
                        .foregroundColor(isError ? .red.opacity(0.9) : .white.opacity(0.8))
                        .padding(.bottom, 16)
                }
                .padding(.top, 12)
            }
            .blur(radius: billingLoaded && !websiteAppUnlocked ? 9 : 0)
            .allowsHitTesting(billingLoaded && websiteAppUnlocked)

            if billingLoaded && !websiteAppUnlocked {
                VStack(spacing: 14) {
                    Text("Upgrade on the website")
                        .font(.title3.bold())
                        .foregroundColor(.white)
                    Text("Subscribe to Regular to unlock the app and use AI (5 included requests/mo) or add Premium AI for unlimited. All purchases are on the Hit-A-Lick site — no in-app purchases.")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.82))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                    Link(destination: APIConfig.membershipPurchaseURL) {
                        Text("Open pricing in Safari")
                            .font(.subheadline.weight(.semibold))
                            .foregroundColor(.black)
                            .padding(.vertical, 10)
                            .padding(.horizontal, 18)
                            .background(Color.cyan)
                            .cornerRadius(12)
                    }
                }
                .padding(24)
                .background(Color.black.opacity(0.55))
                .cornerRadius(16)
                .padding()
            }
        }
        .onAppear {
            pruneStaleCartIfNeeded()
            Task { await loadAiPlaysOfTheDay() }
        }
        .task {
            await refreshBillingAndQuota()
        }
        .screenEntrance()
    }

    @MainActor
    private func refreshBillingAndQuota() async {
        billingLoaded = false
        defer { billingLoaded = true }
        guard let user = Auth.auth().currentUser else {
            billingEntitlement = nil
            quotaText = ""
            return
        }
        do {
            let token = try await user.getIDToken()
            billingEntitlement = try await APIServices.shared.fetchBillingEntitlement(uid: user.uid, token: token)
            await refreshAiQuota()
        } catch {
            billingEntitlement = nil
        }
    }

    private func formatAmericanOdds(_ o: Int) -> String {
        o > 0 ? "+\(o)" : "\(o)"
    }

    @MainActor
    private func loadAiPlaysOfTheDay() async {
        aiPlaysLoading = true
        aiPlaysStatus = ""
        aiPlaysSnapshotNote = ""
        defer { aiPlaysLoading = false }
        if let url = URL(string: "\(baseURL)/api/ai/plays-of-day") {
            do {
                let (data, response) = try await URLSession.shared.data(from: url)
                if let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode),
                   let decoded = try? JSONDecoder().decode(AIPlaysOfDayAPIResponse.self, from: data),
                   let remote = decoded.picks, !remote.isEmpty
                {
                    let rows = Self.rowsFromScheduledApiPicks(remote)
                    if !rows.isEmpty {
                        aiPlaysRows = rows
                        if let dk = decoded.dateKey?.trimmingCharacters(in: .whitespacesAndNewlines), !dk.isEmpty {
                            aiPlaysSnapshotNote = "Daily snapshot \(dk) (6am Eastern)."
                        }
                        return
                    }
                }
            } catch {
                /* fall through to live props */
            }
        }
        do {
            let env = try await APIServices.shared.fetchPropsSnapshot(for: "all")
            aiPlaysRows = Self.computeAiPlaysOfTheDay(from: env.props)
        } catch {
            aiPlaysRows = []
            aiPlaysStatus = error.localizedDescription
        }
    }

    private static let aiPlayBookOrder: [String] = [
        "fanduel", "draftkings", "prizepicks", "underdog", "betmgm",
        "williamhill_us", "caesars", "pointsbetus", "espnbet", "pick6", "betr_us_dfs",
    ]

    private static func bookQuoteRank(_ key: String) -> Int {
        let k = key.lowercased()
        if let i = aiPlayBookOrder.firstIndex(of: k) { return i }
        return 900
    }

    private static func bookAbbrevDisplay(_ key: String) -> String {
        let filtered = String(key.lowercased().filter { $0.isLetter || $0.isNumber })
        let map: [String: String] = [
            "fanduel": "FD", "draftkings": "DK", "betmgm": "MGM", "williamhillus": "WH",
            "caesars": "CZR", "pointsbetus": "PB", "espnbet": "ESPN", "prizepicks": "PP",
            "underdog": "UD", "pick6": "P6", "betrusdfs": "BETR",
        ]
        return map[filtered] ?? key.replacingOccurrences(of: "_", with: " ").uppercased()
    }

    private static func legSideDisplay(_ side: String?) -> String {
        let s = (side ?? "").lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if s == "over" || s == "o" { return "Over" }
        if s == "under" || s == "u" { return "Under" }
        if s.contains("over") { return "Over" }
        if s.contains("under") { return "Under" }
        return (side ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func extractPlayerFromLabel(_ label: String) -> String {
        let s = label.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return "" }
        let noOu = s.replacingOccurrences(of: #"\s+(Over|Under)$"#, with: "", options: [.regularExpression, .caseInsensitive])
        let parts = noOu.split(separator: " ").map(String.init)
        var out: [String] = []
        for p in parts {
            if let c = p.first, c.isNumber { break }
            if p.lowercased() == "o/u" { break }
            out.append(p)
        }
        return out.isEmpty ? noOu : out.joined(separator: " ")
    }

    private static func propMarketTitle(_ market: String?) -> String {
        let k = (market ?? "").lowercased()
        let map: [String: String] = [
            "player_points": "Points",
            "player_rebounds": "Rebounds",
            "player_assists": "Assists",
            "player_threes": "Three-pointers made",
            "player_blocks": "Blocks",
            "player_steals": "Steals",
            "player_turnovers": "Turnovers",
            "player_points_rebounds_assists": "Points + rebounds + assists",
            "player_points_rebounds": "Points + rebounds",
            "player_points_assists": "Points + assists",
            "player_rebounds_assists": "Rebounds + assists",
            "player_pass_yds": "Passing yards",
            "player_pass_tds": "Passing touchdowns",
            "player_rush_yds": "Rushing yards",
            "player_receptions": "Receptions",
        ]
        if let t = map[k] { return t }
        return k.replacingOccurrences(of: "_", with: " ").split(separator: " ")
            .map(\.capitalized)
            .joined(separator: " ")
    }

    private static func buildPropSentence(leg: PlayerProp) -> String {
        let rawP = (leg.playerName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let fromL = extractPlayerFromLabel(leg.label ?? "")
        let player = !rawP.isEmpty ? rawP : (!fromL.isEmpty ? fromL : "Player")
        let side = legSideDisplay(leg.side)
        let lineStr: String = {
            if let line = leg.line { return String(format: "%.1f", line) }
            return ""
        }()
        let market = propMarketTitle(leg.market)
        var parts: [String] = [player]
        if !side.isEmpty { parts.append(side) }
        if !lineStr.isEmpty { parts.append(lineStr) }
        parts.append(market)
        return parts.joined(separator: " ")
    }

    private static func rowsFromScheduledApiPicks(_ legs: [AIPlaysOfDayAPILeg]) -> [AIPlayOfTheDayRow] {
        legs.enumerated().compactMap { idx, x -> AIPlayOfTheDayRow? in
            let rawLabel = x.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let shortHead = rawLabel.isEmpty ? "Player prop" : rawLabel
            let sport = ((x.sport ?? "").uppercased())
            let matchup = x.matchup ?? ""
            let conf = x.confidence ?? 0

            var uiQuotes: [AIPlayBookQuoteUI] = []
            if let qs = x.quotes, !qs.isEmpty {
                for (j, q) in qs.enumerated() {
                    guard let bk = q.bookKey?.trimmingCharacters(in: .whitespacesAndNewlines), !bk.isEmpty,
                          let od = q.odds
                    else { continue }
                    let ok = q.okPrice ?? true
                    uiQuotes.append(AIPlayBookQuoteUI(
                        id: "sched_\(idx)_\(j)_\(bk)",
                        abbrev: bookAbbrevDisplay(bk),
                        odds: od,
                        okPrice: ok
                    ))
                }
            } else if let odds = x.odds,
                      let bk = x.bookKey?.trimmingCharacters(in: .whitespacesAndNewlines), !bk.isEmpty
            {
                uiQuotes.append(AIPlayBookQuoteUI(
                    id: "sched_\(idx)_\(bk)",
                    abbrev: bookAbbrevDisplay(bk),
                    odds: odds,
                    okPrice: true
                ))
            }
            guard !uiQuotes.isEmpty else { return nil }

            let trimmedSentence = x.propSentence?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let sentence: String
            if !trimmedSentence.isEmpty {
                sentence = trimmedSentence
            } else if let line = x.line {
                let side = (x.side ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                let lineStr = side.isEmpty ? String(format: "%.1f", line) : "\(side) \(line)"
                sentence = "\(shortHead) · \(lineStr)"
            } else {
                sentence = shortHead
            }

            return AIPlayOfTheDayRow(
                id: "scheduled_\(idx)_\(String(sentence.prefix(32)))",
                propSentence: sentence,
                sport: sport.isEmpty ? "—" : sport,
                matchup: matchup,
                quotes: uiQuotes,
                confidencePct: conf
            )
        }
    }

    /// American odds no worse than -190 (favorites); plus money allowed.
    private static func americanOddsMeetsMinPayout(_ american: Int) -> Bool {
        if american > 0 { return true }
        return american >= -190
    }

    private static func computeAiPlaysOfTheDay(from props: [Prop]) -> [AIPlayOfTheDayRow] {
        let minConf = 60.0
        struct Scored {
            let score: Double
            let row: AIPlayOfTheDayRow
        }
        var rows: [Scored] = []
        for p in props {
            let gConf = p.confidence ?? 55
            if gConf < minConf - 5 { continue }
            for leg in p.playerProps ?? [] {
                if leg.synthetic == true { continue }
                if leg.projected == true { continue }
                let rawLbl = (leg.label ?? "").lowercased()
                if rawLbl.contains("synthetic") || rawLbl.contains("placeholder") { continue }

                var paired: [(String, Int)] = []
                if let bqs = leg.bookQuotes, !bqs.isEmpty {
                    for q in bqs {
                        guard let bk = q.bookKey?.trimmingCharacters(in: .whitespacesAndNewlines), !bk.isEmpty,
                              let od = q.odds
                        else { continue }
                        paired.append((bk, od))
                    }
                } else if let bk = leg.bookKey?.trimmingCharacters(in: .whitespacesAndNewlines), !bk.isEmpty,
                          let od = leg.odds
                {
                    paired.append((bk, od))
                }
                var seenBooks = Set<String>()
                paired = paired.filter { pair in
                    let k = pair.0.lowercased()
                    if seenBooks.contains(k) { return false }
                    seenBooks.insert(k)
                    return true
                }
                guard !paired.isEmpty else { continue }

                let qualifying = paired.filter { americanOddsMeetsMinPayout($0.1) }
                guard !qualifying.isEmpty else { continue }
                qualifying.sort { a, b in
                    let ra = bookQuoteRank(a.0)
                    let rb = bookQuoteRank(b.0)
                    if ra != rb { return ra < rb }
                    return a.1 > b.1
                }
                let primary = qualifying[0]
                let legConf = leg.confidence ?? gConf
                if legConf < minConf { continue }
                let odds = primary.1
                let oddsNum = Double(odds)
                let plusBump = odds > 0 ? min(12, oddsNum / 20) : 0
                let rel = Double(p.analytics?.reliabilityScore ?? 0)
                let score = legConf + plusBump + gConf * 0.03 + rel * 0.02

                paired.sort { a, b in
                    let rsa = bookQuoteRank(a.0)
                    let rsb = bookQuoteRank(b.0)
                    if rsa != rsb { return rsa < rsb }
                    return a.1 > b.1
                }
                let uiQuotes: [AIPlayBookQuoteUI] = paired.prefix(12).enumerated().map { j, pair in
                    AIPlayBookQuoteUI(
                        id: "\(p.id)_\(leg.id)_\(j)_\(pair.0)",
                        abbrev: bookAbbrevDisplay(pair.0),
                        odds: pair.1,
                        okPrice: americanOddsMeetsMinPayout(pair.1)
                    )
                }
                let sentence = buildPropSentence(leg: leg)
                let row = AIPlayOfTheDayRow(
                    id: "\(p.id)_\(leg.id)",
                    propSentence: sentence,
                    sport: p.sport.uppercased(),
                    matchup: p.matchup,
                    quotes: uiQuotes,
                    confidencePct: Int(legConf.rounded())
                )
                rows.append(Scored(score: score, row: row))
            }
        }
        rows.sort { $0.score > $1.score }
        return rows.prefix(3).map(\.row)
    }

    private func touchCart() {
        cartLastTouchEpoch = Date().timeIntervalSince1970
    }

    private func pruneStaleCartIfNeeded() {
        let last = Date(timeIntervalSince1970: cartLastTouchEpoch)
        if cartLastTouchEpoch > 0, Date().timeIntervalSince(last) > cartStaleSeconds {
            cart = []
            cartLastTouchEpoch = 0
            statusText = "Stale cart cleared (not submitted within 48h)."
            isError = false
        }
    }

    private func generatePicks() {
        Task {
            do {
                isGenerating = true
                guard let user = Auth.auth().currentUser else {
                    statusText = "Log in first to use AI Picks."
                    isError = true
                    isGenerating = false
                    return
                }

                let token = try await user.getIDToken()
                let payload: [String: Any] = [
                    "uid": user.uid,
                    "sport": sport,
                    "minConfidence": Int(minConfidence),
                    "maxPicks": maxPicks,
                    "preferredBooks": preferredBooks
                        .split(separator: ",")
                        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
                        .filter { !$0.isEmpty }
                ]

                let data = try await post(path: "/api/ai/picks", token: token, payload: payload)
                let decoded = try JSONDecoder().decode(AIPicksResponse.self, from: data)
                picks = decoded.picks
                pruneStaleCartIfNeeded()
                statusText = "Generated \(picks.count) AI picks."
                await refreshAiQuota()
                isError = false
                isGenerating = false
            } catch {
                statusText = "AI picks failed: \(error.localizedDescription)"
                isError = true
                isGenerating = false
            }
        }
    }

    private func calculateParlay() {
        Task {
            do {
                isCalculating = true
                guard let user = Auth.auth().currentUser else {
                    statusText = "Log in first to calculate parlays."
                    isError = true
                    isCalculating = false
                    return
                }
                guard !cart.isEmpty else {
                    statusText = "Add picks to cart first."
                    isError = true
                    isCalculating = false
                    return
                }
                let parsedStake = Double(stake) ?? 0
                let token = try await user.getIDToken()
                let payload: [String: Any] = [
                    "uid": user.uid,
                    "stake": parsedStake,
                    "picks": cart.map { ["label": $0.label, "odds": $0.odds] }
                ]
                let data = try await post(path: "/api/ai/parlay", token: token, payload: payload)
                let result = try JSONDecoder().decode(AIParlayResponse.self, from: data)
                let ret = result.projectedReturn.map { String(format: "%.2f", $0) } ?? "-"
                let profit = result.projectedProfit.map { String(format: "%.2f", $0) } ?? "-"
                statusText = "Legs \(result.legCount) • Decimal \(String(format: "%.2f", result.parlayDecimal)) • Return $\(ret) • Profit $\(profit)"
                isError = false
                isCalculating = false
                touchCart()
                cart = []
                cartLastTouchEpoch = 0
            } catch {
                statusText = "Parlay calc failed: \(error.localizedDescription)"
                isError = true
                isCalculating = false
            }
        }
    }

    private func runCopilot() {
        Task {
            do {
                isCopilotLoading = true
                guard let user = Auth.auth().currentUser else {
                    statusText = "Log in first."
                    isError = true
                    isCopilotLoading = false
                    return
                }
                let token = try await user.getIDToken()
                let payload: [String: Any] = [
                    "uid": user.uid,
                    "sport": sport,
                    "message": copilotMessage,
                ]
                let data = try await post(path: "/api/ai/copilot", token: token, payload: payload)
                copilotReply = try JSONDecoder().decode(AICopilotResponse.self, from: data)
                isCopilotLoading = false
                await refreshAiQuota()
            } catch {
                statusText = "Copilot failed: \(error.localizedDescription)"
                isError = true
                isCopilotLoading = false
            }
        }
    }

    @MainActor
    private func refreshAiQuota() async {
        guard let user = Auth.auth().currentUser else {
            quotaText = ""
            return
        }
        do {
            let token = try await user.getIDToken()
            var req = URLRequest(url: URL(string: "\(baseURL)/api/ai/quota?uid=\(user.uid)")!)
            req.hitApplySessionHeaders(firebaseIdToken: token)
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                quotaText = ""
                return
            }
            let q = try JSONDecoder().decode(AIQuotaResponse.self, from: data)
            aiMeterExhausted = false
            if q.unlimited == true {
                if q.staff == "owner" {
                    quotaText = "AI: unlimited (owner)"
                } else if q.staff == "giap" {
                    quotaText = "AI: unlimited (Giap staff)"
                } else {
                    quotaText = "AI: unlimited (Premium plan)"
                }
            } else if q.locked == true {
                quotaText = "AI locked — subscribe on the website (Regular includes 5 AI requests/mo; Premium adds unlimited)."
                aiMeterExhausted = true
            } else if let lim = q.limit, lim > 0 {
                let used = q.used ?? 0
                let rem = q.remaining ?? max(0, lim - used)
                quotaText = "AI this month: \(used) / \(lim) used (\(rem) left). Premium = unlimited."
                if rem <= 0 {
                    aiMeterExhausted = true
                    quotaText = "AI cap reached (\(used)/\(lim)). Open pricing to add Premium AI or buy +50 requests on the site."
                }
            } else {
                quotaText = ""
            }
        } catch {
            quotaText = ""
        }
    }

    private func post(path: String, token: String, payload: [String: Any]) async throws -> Data {
        let url = URL(string: "\(baseURL)\(path)")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw NSError(domain: "AI", code: -1) }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "AI", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: body])
        }
        return data
    }
}
