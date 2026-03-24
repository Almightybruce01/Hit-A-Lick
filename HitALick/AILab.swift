import SwiftUI
import FirebaseAuth

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
    @AppStorage("hitalick_ai_cart_touch") private var cartLastTouchEpoch: Double = 0

    private let sports = ["nba", "nfl", "mlb", "wnba"]
    private let cartStaleSeconds: TimeInterval = 48 * 3600
    private var baseURL: String { APIConfig.baseURL }

    var body: some View {
        ZStack {
            EliteBackground()

            ScrollView {
                VStack(spacing: 12) {
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
                            .disabled(isGenerating)
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
                            .disabled(isCopilotLoading)
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
                            .disabled(isCalculating)
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
        }
        .onAppear {
            pruneStaleCartIfNeeded()
        }
        .screenEntrance()
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
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                quotaText = ""
                return
            }
            let q = try JSONDecoder().decode(AIQuotaResponse.self, from: data)
            if q.unlimited == true {
                if q.staff == "owner" {
                    quotaText = "AI: unlimited (owner)"
                } else if q.staff == "giap" {
                    quotaText = "AI: unlimited (Giap staff)"
                } else {
                    quotaText = "AI: unlimited with your membership"
                }
            } else if let lim = q.limit {
                let used = q.used ?? 0
                let rem = q.remaining ?? max(0, lim - used)
                quotaText = "AI this month: \(used)/\(lim) used (\(rem) left)"
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
