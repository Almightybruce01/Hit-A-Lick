

import SwiftUI
import FirebaseAuth
#if canImport(UIKit)
import UIKit
#endif

struct PickItem: Decodable, Identifiable {
    var id: String { "\(title)-\(pick)-\(gameDate)" }
    let title: String
    let league: String
    let pick: String
    let notes: String
    let confidence: Double
    let gameDate: String
}

struct PicksFeedResponse: Decodable {
    let tier: String
    let headline: String
    let hitRateClaim: String
    let items: [PickItem]
}

struct EliteBootstrapResponse: Decodable {
    let tier: String?
    let boards: [EliteBoard]?
    let presets: [ElitePreset]?
}

struct EliteBoard: Decodable, Identifiable {
    var id: String { title + (createdAt ?? "") }
    let title: String
    let createdAt: String?
    let picks: [EliteBoardPick]?
}

struct EliteBoardPick: Decodable, Identifiable {
    var id: String { "\(label)-\(bestOdds ?? 0)-\(line ?? 0)" }
    let label: String
    let side: String?
    let line: Double?
    let bestOdds: Int?
}

struct ElitePreset: Decodable, Identifiable {
    var id: String { "\(name ?? "preset")-\(sport ?? "all")-\(market ?? "all")" }
    let name: String?
    let sport: String?
    let market: String?
}

private let curatorSlugs = ["bruce", "giap"]

struct Premium: View {
    @AppStorage("hitalick_tier") private var tierRaw: String = UserTier.core.rawValue
    @AppStorage("hitalick_staff_unlock") private var staffVIPUnlock: Bool = false
    @State private var curatorTab = "bruce"
    @State private var boards: [String: CuratorBoardAPIResponse] = [:]
    @State private var entitlement: BillingEntitlementPayload?
    @State private var loadError: String?
    @State private var isPreviewMode = false
    @State private var pulse = false
    @State private var syncedBoards: [EliteBoard] = []
    @State private var syncedPresets: [ElitePreset] = []
    @State private var draftBoardTitle: String = ""
    @State private var draftPresetName: String = ""
    @State private var syncStatus: String = ""
    @State private var isSyncing = false

    private var userTier: UserTier { UserTier(rawValue: tierRaw) ?? .core }

    private var entitlementUnlocked: Bool {
        guard let e = entitlement, e.active == true else { return false }
        if e.unlocksStaffVIPFeatures { return true }
        guard e.effectiveHasAppAccess else { return false }
        if e.curatorAllAccess == true { return true }
        if let ids = e.curatorIds, !ids.isEmpty { return true }
        return false
    }

    private func canViewCurator(_ slug: String) -> Bool {
        guard let e = entitlement, e.active == true else { return false }
        if e.unlocksStaffVIPFeatures { return true }
        guard e.effectiveHasAppAccess else { return false }
        let s = slug.lowercased()
        if let ids = e.curatorIds, ids.map({ $0.lowercased() }).contains(s) { return true }
        return false
    }

    /// User-facing line for when this curator last published picks (server `lastPickPostAt`).
    private func formatLastPickPosted(iso: String?) -> String? {
        guard let iso, !iso.isEmpty else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var d = f.date(from: iso)
        if d == nil {
            f.formatOptions = [.withInternetDateTime]
            d = f.date(from: iso)
        }
        guard let date = d else { return "Latest picks posted: \(iso)" }
        let rel = RelativeDateTimeFormatter()
        rel.unitsStyle = .abbreviated
        return "Latest picks posted \(rel.localizedString(for: date, relativeTo: Date()))"
    }

    var body: some View {
        ZStack {
            curatorBackground

            ScrollView {
                VStack(spacing: 16) {
                    Image("HitALicklogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 180, height: 80)
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                    Text("Curator Picks")
                        .font(.largeTitle)
                        .bold()
                        .foregroundColor(.orange)

                    Text("Same boards on the bottom tab: Picks (Bruce & Giap).")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)

                    Text("Bruce and Giap each have a separate subscription on the website. You also need a Regular app plan to view boards in the app — no in-app purchases.")
                        .font(.subheadline)
                        .foregroundColor(.white)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)

                    Text("Tier: \(userTier.label)")
                        .font(.caption2)
                        .foregroundColor(.cyan.opacity(0.9))

                    if isPreviewMode {
                        Text("Preview mode: log in with a curator pass or Bruce/Giap staff email to load live boards.")
                            .font(.caption)
                            .foregroundColor(.yellow.opacity(0.95))
                            .padding(.horizontal)
                    }

                    curatorTabBar

                    ElitePanel {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Membership")
                                .font(.headline)
                                .foregroundColor(.white)
                            Text("Bruce Pick’s and Giap Pick’s each publish a board from the universal pool (fans open the Picks tab). Past results only show picks that were officially logged.")
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.82))
                            HStack(spacing: 8) {
                                MetricChip(title: "Access", value: entitlementUnlocked ? "Live" : "Preview", isPositive: entitlementUnlocked)
                                MetricChip(title: "Tab", value: curatorTab.uppercased(), isPositive: true)
                            }
                        }
                    }
                    .padding(.horizontal)

                    curatorBoardPanel

                    if entitlementUnlocked {
                        ElitePanel {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Synced Strategy Assets")
                                    .font(.headline)
                                    .foregroundColor(.white)
                                Text("Boards: \(syncedBoards.count) • Presets: \(syncedPresets.count)")
                                    .font(.caption)
                                    .foregroundColor(.white.opacity(0.8))
                                ForEach(syncedBoards.prefix(3)) { board in
                                    Text("• \(board.title) (\((board.picks ?? []).count) picks)")
                                        .font(.caption2)
                                        .foregroundColor(.green.opacity(0.9))
                                }
                                if syncedBoards.isEmpty {
                                    Text("No synced boards yet.")
                                        .font(.caption2)
                                        .foregroundColor(.white.opacity(0.65))
                                }

                                Divider().background(Color.white.opacity(0.25))

                                Text("Write-Sync (iOS → Cloud)")
                                    .font(.caption.weight(.semibold))
                                    .foregroundColor(.white.opacity(0.9))

                                TextField("Board title", text: $draftBoardTitle)
                                    .padding(10)
                                    .background(Color.white.opacity(0.1))
                                    .cornerRadius(10)
                                    .foregroundColor(.white)

                                HStack(spacing: 8) {
                                    GlassPrimaryButton(title: isSyncing ? "Saving..." : "Save Board") {
                                        saveBoardToCloud()
                                    }
                                    .disabled(isSyncing || draftBoardTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                }

                                TextField("Preset name", text: $draftPresetName)
                                    .padding(10)
                                    .background(Color.white.opacity(0.1))
                                    .cornerRadius(10)
                                    .foregroundColor(.white)

                                GlassPrimaryButton(title: isSyncing ? "Saving..." : "Save Preset") {
                                    savePresetToCloud()
                                }
                                .disabled(isSyncing || draftPresetName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                                if !syncStatus.isEmpty {
                                    Text(syncStatus)
                                        .font(.caption2)
                                        .foregroundColor(.cyan.opacity(0.92))
                                }
                            }
                        }
                        .padding(.horizontal)
                    }

                    if let loadError {
                        Text(loadError)
                            .font(.footnote)
                            .foregroundColor(.red.opacity(0.9))
                            .padding(.horizontal)
                    }
                }
                .padding(.top, 48)
                .padding(.bottom, 36)
            }
        }
        .task {
            await loadEntitlementAndBoards()
        }
        .task(id: curatorTab) {
            await loadBoard(slug: curatorTab)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
        .screenEntrance()
    }

    @ViewBuilder
    private var curatorBackground: some View {
        let hex = boards[curatorTab]?.profile.backgroundHex ?? "#0a1227"
        let accent = boards[curatorTab]?.profile.accentHex ?? "#ff9f0a"
        let bgDataUrl = boards[curatorTab]?.profile.backgroundImageDataUrl
        ZStack {
            EliteBackground()
            #if canImport(UIKit)
            if let bgDataUrl, let ui = curatorImageFromDataUrl(bgDataUrl) {
                Image(uiImage: ui)
                    .resizable()
                    .scaledToFill()
                    .ignoresSafeArea()
                    .opacity(0.42)
            }
            #endif
            LinearGradient(
                colors: [
                    Color(hex: hex).opacity(0.45),
                    Color(hex: accent).opacity(0.22),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
        }
    }

    private var curatorTabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(curatorSlugs, id: \.self) { slug in
                    let label = labelForSlug(slug)
                    Button {
                        curatorTab = slug
                        EliteHaptics.light()
                    } label: {
                        Text(label)
                            .font(.system(size: 13, weight: curatorTab == slug ? .heavy : .semibold))
                            .foregroundColor(curatorTab == slug ? .black : .white.opacity(0.85))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(
                                Capsule()
                                    .fill(curatorTab == slug ? Color.orange : Color.white.opacity(0.12))
                            )
                            .overlay(
                                Capsule()
                                    .stroke(Color.white.opacity(0.2), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
        }
    }

    private func labelForSlug(_ slug: String) -> String {
        switch slug {
        case "giap": return "Giap Pick's"
        case "bruce": return "Bruce Pick's"
        default: return slug.uppercased()
        }
    }

    @ViewBuilder
    private var curatorBoardPanel: some View {
        let board = boards[curatorTab]
        VStack(alignment: .leading, spacing: 12) {
            Text(labelForSlug(curatorTab))
                .font(.headline)
                .foregroundColor(.orange)

            if let b = board {
                HStack(alignment: .center, spacing: 12) {
                    #if canImport(UIKit)
                    if let url = b.profile.photoDataUrl, let ui = curatorImageFromDataUrl(url) {
                        Image(uiImage: ui)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 52, height: 52)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.white.opacity(0.22), lineWidth: 1)
                            )
                    }
                    #endif
                    VStack(alignment: .leading, spacing: 4) {
                        Text(b.profile.displayName ?? b.label)
                            .font(.subheadline.weight(.semibold))
                            .foregroundColor(.white)
                        if let wp = b.profile.winPct {
                            Text("Win \(String(format: "%.1f", wp))%")
                                .font(.caption.weight(.bold))
                                .foregroundColor(.green)
                        }
                    }
                    Spacer()
                }
                Text("Record W\(b.profile.wins ?? 0)-L\(b.profile.losses ?? 0)-P\(b.profile.pushes ?? 0)")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.75))

                if let posted = formatLastPickPosted(iso: b.lastPickPostAt) {
                    Text(posted)
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.cyan.opacity(0.92))
                }

                if let parlays = b.parlays, !parlays.isEmpty {
                    Text("Featured parlays")
                        .font(.caption.weight(.heavy))
                        .foregroundColor(.mint.opacity(0.98))
                        .padding(.top, 4)
                    ForEach(parlays, id: \.stableId) { p in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(p.title ?? "Parlay")
                                .font(.subheadline.weight(.bold))
                                .foregroundColor(.white)
                            if let legs = p.legs {
                                ForEach(Array(legs.enumerated()), id: \.offset) { _, leg in
                                    HStack {
                                        Text(leg.label ?? "Leg")
                                            .font(.caption)
                                            .foregroundColor(.white.opacity(0.92))
                                        Spacer()
                                        if let o = leg.odds {
                                            Text(formatAmericanOdds(o))
                                                .font(.caption.monospacedDigit())
                                                .foregroundColor(.cyan.opacity(0.95))
                                        }
                                    }
                                }
                            }
                            if let note = p.note, !note.isEmpty {
                                Text(note)
                                    .font(.caption2)
                                    .foregroundColor(.white.opacity(0.72))
                            }
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.black.opacity(pulse ? 0.4 : 0.24))
                        .cornerRadius(10)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(Color.mint.opacity(0.25), lineWidth: 1)
                        )
                    }
                }

                Text("Upcoming (from universal pool)")
                    .font(.caption.weight(.heavy))
                    .foregroundColor(.cyan.opacity(0.95))
                    .padding(.top, 6)

                if b.upcoming.isEmpty {
                    Text("No upcoming legs selected for this curator yet.")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                } else {
                    ForEach(b.upcoming.prefix(24)) { row in
                        curatorRowView(row: row)
                    }
                }

                Text("Previous (logged results only)")
                    .font(.caption.weight(.heavy))
                    .foregroundColor(.orange.opacity(0.95))
                    .padding(.top, 10)

                if b.history.isEmpty {
                    Text("No settled picks logged yet.")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.65))
                } else {
                    ForEach(b.history.prefix(40)) { h in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(h.title ?? "Pick")
                                .font(.subheadline.weight(.semibold))
                                .foregroundColor(.white)
                            HStack {
                                Text((h.result ?? "—").uppercased())
                                    .font(.caption.weight(.bold))
                                    .foregroundColor(resultColor(h.result))
                                if let d = h.settledAt {
                                    Text(d)
                                        .font(.caption2)
                                        .foregroundColor(.white.opacity(0.55))
                                }
                            }
                        }
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.black.opacity(pulse ? 0.34 : 0.18))
                        .cornerRadius(8)
                    }
                }

                SparklineChart(values: b.upcoming.prefix(8).compactMap { $0.confidence })
            } else if loadError == nil {
                VStack(spacing: 10) {
                    SkeletonBlock()
                    SkeletonBlock()
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black.opacity(0.35))
        .cornerRadius(12)
        .padding(.horizontal)
    }

    private func formatAmericanOdds(_ n: Int) -> String {
        if n > 0 { return "+\(n)" }
        return "\(n)"
    }

    private func resultColor(_ r: String?) -> Color {
        let x = (r ?? "").lowercased()
        if x == "win" || x == "w" { return .green }
        if x == "loss" || x == "l" { return .red.opacity(0.9) }
        return .yellow.opacity(0.9)
    }

    private func curatorRowView(row: CuratorPickRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.title ?? "Pick")
                .foregroundColor(.white)
                .font(.subheadline)
            Text("\(row.league ?? "") • \(row.pick ?? "")")
                .foregroundColor(.green)
                .font(.caption)
            Text(row.notes ?? "")
                .foregroundColor(.white.opacity(0.8))
                .font(.caption2)
            Text("Confidence \(Int(row.confidence ?? 0))% • \(row.gameDate ?? "")")
                .foregroundColor(.white.opacity(0.65))
                .font(.caption2)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black.opacity(pulse ? 0.34 : 0.18))
        .cornerRadius(8)
    }

    @MainActor
    private func loadEntitlementAndBoards() async {
        do {
            guard let user = Auth.auth().currentUser else {
                isPreviewMode = true
                staffVIPUnlock = false
                boards = CuratorBoardAPIResponse.previewAll()
                return
            }
            let token = try await user.getIDToken()
            entitlement = try await APIServices.shared.fetchBillingEntitlement(uid: user.uid, token: token)
            staffVIPUnlock = entitlement?.unlocksStaffVIPFeatures ?? false

            if !entitlementUnlocked {
                isPreviewMode = true
                boards = CuratorBoardAPIResponse.previewAll()
                loadError = nil
                return
            }

            async let eliteState = fetchEliteBootstrap(uid: user.uid, token: token)
            let boot = try await eliteState
            syncedBoards = boot.boards ?? []
            syncedPresets = boot.presets ?? []

            await loadBoard(slug: curatorTab)
            isPreviewMode = false
            loadError = nil
        } catch {
            isPreviewMode = true
            staffVIPUnlock = false
            loadError = error.localizedDescription
            boards = CuratorBoardAPIResponse.previewAll()
        }
    }

    @MainActor
    private func loadBoard(slug: String) async {
        guard let user = Auth.auth().currentUser else { return }
        if !canViewCurator(slug) {
            boards[slug] = CuratorBoardAPIResponse.preview(slug: slug)
            return
        }
        do {
            let token = try await user.getIDToken()
            let b = try await fetchCuratorBoard(slug: slug, uid: user.uid, token: token)
            boards[slug] = b
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func fetchCuratorBoard(slug: String, uid: String, token: String) async throws -> CuratorBoardAPIResponse {
        let url = URL(string: "\(APIConfig.baseURL)/api/curators/\(slug)/board?uid=\(uid)")!
        var request = URLRequest(url: url)
        request.hitApplySessionHeaders(firebaseIdToken: token)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(domain: "Curator", code: -1)
        }
        if http.statusCode == 402 {
            return CuratorBoardAPIResponse.preview(slug: slug)
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw NSError(domain: "Curator", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: body])
        }
        return try JSONDecoder().decode(CuratorBoardAPIResponse.self, from: data)
    }

    private func fetchEliteBootstrap(uid: String, token: String) async throws -> EliteBootstrapResponse {
        let url = URL(string: "\(APIConfig.baseURL)/api/elite/bootstrap?uid=\(uid)")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(EliteBootstrapResponse.self, from: data)
    }

    private func saveBoardToCloud() {
        Task {
            do {
                guard let user = Auth.auth().currentUser else {
                    syncStatus = "Log in to sync."
                    return
                }
                isSyncing = true
                let title = draftBoardTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                let token = try await user.getIDToken()
                let uid = user.uid

                let seedPicks = (boards[curatorTab]?.upcoming ?? []).prefix(3).map {
                    [
                        "label": $0.pick ?? "",
                        "side": "",
                        "line": NSNull(),
                        "bestOdds": NSNull(),
                    ] as [String: Any]
                }
                let newBoard: [String: Any] = [
                    "title": title,
                    "createdAt": ISO8601DateFormatter().string(from: Date()),
                    "picks": Array(seedPicks),
                ]

                let boardsPayload = syncedBoards.map { board in
                    [
                        "title": board.title,
                        "createdAt": board.createdAt ?? "",
                        "picks": (board.picks ?? []).map { pick in
                            [
                                "label": pick.label,
                                "side": pick.side ?? "",
                                "line": pick.line as Any,
                                "bestOdds": pick.bestOdds as Any,
                            ] as [String: Any]
                        },
                    ] as [String: Any]
                } + [newBoard]

                let presetsPayload = syncedPresets.map {
                    [
                        "name": $0.name ?? "Preset",
                        "sport": $0.sport ?? "all",
                        "market": $0.market ?? "all",
                    ] as [String: Any]
                }

                try await saveEliteState(uid: uid, token: token, boards: boardsPayload, presets: presetsPayload)
                draftBoardTitle = ""
                syncStatus = "Board synced to cloud."
                await loadEntitlementAndBoards()
                isSyncing = false
            } catch {
                isSyncing = false
                syncStatus = "Board sync failed: \(error.localizedDescription)"
            }
        }
    }

    private func savePresetToCloud() {
        Task {
            do {
                guard let user = Auth.auth().currentUser else {
                    syncStatus = "Log in to sync."
                    return
                }
                isSyncing = true
                let name = draftPresetName.trimmingCharacters(in: .whitespacesAndNewlines)
                let token = try await user.getIDToken()
                let uid = user.uid

                let boardsPayload = syncedBoards.map { board in
                    [
                        "title": board.title,
                        "createdAt": board.createdAt ?? "",
                        "picks": (board.picks ?? []).map { pick in
                            [
                                "label": pick.label,
                                "side": pick.side ?? "",
                                "line": pick.line as Any,
                                "bestOdds": pick.bestOdds as Any,
                            ] as [String: Any]
                        },
                    ] as [String: Any]
                }

                let presetsPayload = syncedPresets.map {
                    [
                        "name": $0.name ?? "Preset",
                        "sport": $0.sport ?? "all",
                        "market": $0.market ?? "all",
                    ] as [String: Any]
                } + [[
                    "name": name,
                    "sport": "all",
                    "market": "all",
                ]]

                try await saveEliteState(uid: uid, token: token, boards: boardsPayload, presets: presetsPayload)
                draftPresetName = ""
                syncStatus = "Preset synced to cloud."
                await loadEntitlementAndBoards()
                isSyncing = false
            } catch {
                isSyncing = false
                syncStatus = "Preset sync failed: \(error.localizedDescription)"
            }
        }
    }

    private func saveEliteState(uid: String, token: String, boards: [[String: Any]], presets: [[String: Any]]) async throws {
        let url = URL(string: "\(APIConfig.baseURL)/api/elite/state/save")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let payload: [String: Any] = [
            "uid": uid,
            "strategyProfile": "balanced",
            "interests": [],
            "boards": boards,
            "presets": presets,
            "alertPrefs": [
                "minEdgePct": 2.5,
                "minConfidence": 58,
                "minVelocity": 18,
                "steamOnly": false,
            ],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "EliteSync", code: 500, userInfo: [NSLocalizedDescriptionKey: "Cloud save failed."])
        }
    }
}

#if canImport(UIKit)
private func curatorImageFromDataUrl(_ s: String) -> UIImage? {
    guard s.hasPrefix("data:"), let comma = s.firstIndex(of: ",") else { return nil }
    let b64 = String(s[s.index(after: comma)...])
    guard let data = Data(base64Encoded: b64) else { return nil }
    return UIImage(data: data)
}
#endif

private extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch cleaned.count {
        case 6:
            (a, r, g, b) = (255, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = ((int >> 24) & 0xFF, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 10, 18, 39)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
