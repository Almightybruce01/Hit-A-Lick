






import SwiftUI
import FirebaseAuth
import SafariServices

struct HomeScreen: View {
    @AppStorage("isUserLoggedIn") var isUserLoggedIn: Bool = false
    @AppStorage("hitalick_tier") private var tierRaw: String = UserTier.core.rawValue
    @State private var selectedTab = 2
    @State private var tabSwitchGlow = false
    @State private var rootAccessState: RootAccessState = .loading

    private enum RootAccessState {
        case loading
        case needsSignIn
        case needsSubscription
        case unlocked
    }

    private var userTier: UserTier { UserTier(rawValue: tierRaw) ?? .core }

    private var rootOverlayActive: Bool {
        switch rootAccessState {
        case .unlocked, .loading: return false
        case .needsSignIn, .needsSubscription: return true
        }
    }

    var body: some View {
        ZStack {
            EliteBackground()

            VStack(spacing: 0) {
                HStack {
                    Image("HitALicklogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 30, height: 30)
                        .clipShape(RoundedRectangle(cornerRadius: 7))

                    VStack(alignment: .leading, spacing: 1) {
                        Text("HitALick")
                            .font(.title3.bold())
                            .foregroundColor(.orange)
                        Text("Elite Analytics • \(userTier.label)")
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.66))
                    }

                    Spacer()

                    NavigationLink(destination: AccountView()) {
                        Image(systemName: "person.crop.circle.fill")
                            .resizable()
                            .frame(width: 28, height: 28)
                            .foregroundColor(.white)
                    }
                }
                .padding(.horizontal)
                .padding(.top, 12)
                .padding(.bottom, 8)
                .background(
                    LinearGradient(
                        colors: [Color.black.opacity(0.45), Color.blue.opacity(0.2)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

                TabView(selection: $selectedTab) {
                    AILab()
                        .tag(0)
                        .tabItem { Label("AI Lab", systemImage: "sparkles") }

                    Games()
                        .tag(1)
                        .tabItem { Label("Games", systemImage: "gamecontroller.fill") }

                    HomeContent()
                        .tag(2)
                        .tabItem { Label("Home", systemImage: "house.fill") }

                    EliteDashboardView()
                        .tag(3)
                        .tabItem { Label("Desk", systemImage: "rectangle.grid.2x2.fill") }

                    PlayerHub()
                        .tag(4)
                        .tabItem { Label("Players", systemImage: "person.2.fill") }

                    Premium()
                        .tag(5)
                        .tabItem { Label("Picks", systemImage: "person.3.fill") }
                }
                .blur(radius: rootOverlayActive ? 10 : 0)
                .accentColor(.orange)
                .overlay(
                    LinearGradient(
                        colors: [Color.cyan.opacity(0.25), Color.clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .opacity(tabSwitchGlow ? 1 : 0)
                    .allowsHitTesting(false)
                )
                .animation(.easeInOut(duration: 0.24), value: selectedTab)
                .onChange(of: selectedTab) { _ in
                    EliteHaptics.light()
                    withAnimation(.easeOut(duration: 0.2)) { tabSwitchGlow = true }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        withAnimation(.easeIn(duration: 0.22)) { tabSwitchGlow = false }
                    }
                }
            }

            if rootAccessState == .needsSignIn {
                rootGateShell(
                    title: "Sign in",
                    detail: "Create a Hit-A-Lick account from the Account tab if needed. Subscriptions are only on the website — no App Store purchases for membership."
                ) {
                    NavigationLink(destination: AccountView()) {
                        gateCtaLabel("Open Account")
                    }
                }
            } else if rootAccessState == .needsSubscription {
                rootGateShell(
                    title: "Subscribe on the website",
                    detail: "Regular unlocks the app (5 included AI requests/month). Premium adds unlimited AI. Bruce and Giap pick feeds are separate add-ons. Use promo HITALICK25 for 25% off Regular and Premium at checkout."
                ) {
                    NavigationLink(destination: InAppBrowserView(urlString: APIConfig.membershipPurchaseURL.absoluteString)) {
                        gateCtaLabel("Open pricing in Safari")
                    }
                }
            }
        }
        .task {
            await refreshRootWebsiteAccess()
        }
    }

    private func gateCtaLabel(_ text: String) -> some View {
        Text(text)
            .font(.subheadline.weight(.semibold))
            .foregroundColor(.black)
            .padding(.vertical, 10)
            .padding(.horizontal, 18)
            .background(Color.cyan)
            .cornerRadius(12)
    }

    private func rootGateShell<Content: View>(
        title: String,
        detail: String,
        @ViewBuilder cta: () -> Content
    ) -> some View {
        VStack(spacing: 14) {
            Text(title)
                .font(.title3.bold())
                .foregroundColor(.white)
            Text(detail)
                .font(.caption)
                .foregroundColor(.white.opacity(0.85))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)
            cta()
        }
        .padding(24)
        .background(Color.black.opacity(0.62))
        .cornerRadius(18)
        .padding(20)
    }

    @MainActor
    private func refreshRootWebsiteAccess() async {
        rootAccessState = .loading
        guard let user = Auth.auth().currentUser else {
            rootAccessState = .needsSignIn
            return
        }
        do {
            let token = try await user.getIDToken()
            let ent = try await APIServices.shared.fetchBillingEntitlement(uid: user.uid, token: token)
            rootAccessState = (ent?.effectiveHasAppAccess == true) ? .unlocked : .needsSubscription
        } catch {
            rootAccessState = .needsSubscription
        }
    }
}

// MARK: - Embedded Home Content
struct HomeContent: View {
    @AppStorage("hitalick_tier") private var tierRaw: String = UserTier.core.rawValue
    @AppStorage("hitalick_staff_unlock") private var staffVIPUnlock: Bool = false
    @State private var selectedSport: String = "NBA"
    @State private var websiteHasAppAccess = false
    @State private var billingLoaded = false
    private let sports = ["NBA", "NFL", "MLB", "WNBA"]
    private var userTier: UserTier { UserTier(rawValue: tierRaw) ?? .core }

    private var streamUnlocked: Bool {
        staffVIPUnlock || websiteHasAppAccess || hasAccess(tier: userTier, feature: .streamCenter)
    }

    var body: some View {
        ZStack {
            EliteBackground()

            ScrollView {
                VStack(spacing: 16) {
                    ElitePanel {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Elite Control Center")
                                .font(.title2.bold())
                                .foregroundColor(.white)
                            Text("Live props, matchup context, and board intelligence in one place.")
                                .font(.subheadline)
                                .foregroundColor(.white.opacity(0.78))
                            HStack(spacing: 10) {
                                NavigationLink(destination: Props()) {
                                    Text("Open Props")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundColor(.black)
                                        .padding(.vertical, 8)
                                        .padding(.horizontal, 12)
                                        .background(Color.cyan)
                                        .cornerRadius(10)
                                }
                                .simultaneousGesture(TapGesture().onEnded { EliteHaptics.medium() })
                                NavigationLink(destination: EliteDashboardView()) {
                                    Text("Elite Desk")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundColor(.black)
                                        .padding(.vertical, 8)
                                        .padding(.horizontal, 12)
                                        .background(
                                            LinearGradient(
                                                colors: [Color.purple.opacity(0.95), Color.cyan.opacity(0.85)],
                                                startPoint: .leading,
                                                endPoint: .trailing
                                            )
                                        )
                                        .cornerRadius(10)
                                }
                                .simultaneousGesture(TapGesture().onEnded { EliteHaptics.medium() })
                                NavigationLink(destination: Premium()) {
                                    Text("Bruce & Giap Picks")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundColor(.white)
                                        .padding(.vertical, 8)
                                        .padding(.horizontal, 12)
                                        .background(Color.white.opacity(0.14))
                                        .cornerRadius(10)
                                }
                                .simultaneousGesture(TapGesture().onEnded { EliteHaptics.medium() })
                                NavigationLink(destination: OfficialStreamsView()) {
                                    Text("Official Streams")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundColor(streamUnlocked ? .white : .white.opacity(0.45))
                                        .padding(.vertical, 8)
                                        .padding(.horizontal, 12)
                                        .background(Color.white.opacity(0.14))
                                        .cornerRadius(10)
                                }
                                .disabled(!streamUnlocked)
                                .simultaneousGesture(TapGesture().onEnded { EliteHaptics.medium() })
                            }
                            if !streamUnlocked {
                                Text("Subscribe on the Hit-A-Lick website (Regular or Premium) to unlock Official Streams — no in-app purchases.")
                                    .font(.caption2)
                                    .foregroundColor(.yellow.opacity(0.9))
                            }
                            HStack(spacing: 8) {
                                MetricChip(title: "Books", value: "Multi", isPositive: true)
                                MetricChip(title: "AI", value: "Ready", isPositive: true)
                                MetricChip(title: "Mode", value: "Pro", isPositive: true)
                            }
                        }
                    }
                    .task {
                        await syncStaffVIPFromServer()
                    }

                    ElitePanel {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Sport Focus")
                                .font(.headline)
                                .foregroundColor(.white)
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(sports, id: \.self) { sport in
                                        Button {
                                            selectedSport = sport
                                            EliteHaptics.light()
                                        } label: {
                                            Text(sport)
                                                .font(.caption.weight(.semibold))
                                                .foregroundColor(selectedSport == sport ? .black : .white)
                                                .padding(.vertical, 8)
                                                .padding(.horizontal, 12)
                                                .background(selectedSport == sport ? Color.orange : Color.white.opacity(0.12))
                                                .cornerRadius(999)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    ElitePanel {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Market Lanes")
                                .font(.headline)
                                .foregroundColor(.white)
                            let propTypes = propsForSport(selectedSport)
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                                ForEach(propTypes, id: \.self) { type in
                                    Text(type)
                                        .font(.caption.weight(.semibold))
                                        .foregroundColor(.green.opacity(0.95))
                                        .frame(maxWidth: .infinity, minHeight: 36)
                                        .background(Color.black.opacity(0.26))
                                        .cornerRadius(10)
                                }
                            }
                            SparklineChart(values: [51, 54, 52, 58, 55, 60, 57])
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.top, 14)
                .padding(.bottom, 28)
            }
        }
        .screenEntrance()
        .task {
            await refreshWebsiteEntitlement()
        }
    }

    @MainActor
    private func refreshWebsiteEntitlement() async {
        billingLoaded = false
        defer { billingLoaded = true }
        guard let user = Auth.auth().currentUser else {
            websiteHasAppAccess = false
            return
        }
        do {
            let token = try await user.getIDToken()
            let ent = try await APIServices.shared.fetchBillingEntitlement(uid: user.uid, token: token)
            websiteHasAppAccess = ent?.effectiveHasAppAccess ?? false
        } catch {
            websiteHasAppAccess = false
        }
    }

    @MainActor
    private func syncStaffVIPFromServer() async {
        guard Auth.auth().currentUser != nil else {
            staffVIPUnlock = false
            return
        }
        guard let user = Auth.auth().currentUser else {
            staffVIPUnlock = false
            return
        }
        do {
            let token = try await user.getIDToken()
            let ent = try await APIServices.shared.fetchBillingEntitlement(uid: user.uid, token: token)
            staffVIPUnlock = ent?.unlocksStaffVIPFeatures ?? false
        } catch {
            staffVIPUnlock = false
        }
    }

    func propsForSport(_ sport: String) -> [String] {
        switch sport {
        case "NBA", "WNBA": return ["Pts", "Rebs", "Asts", "3Pts", "Stls", "Blks"]
        case "NFL": return ["TDs", "Rush Yds", "Rec Yds", "INTs"]
        case "MLB": return ["HRs", "RBIs", "Hits", "Ks"]
        case "Golf": return ["Birdies", "Pars", "Bogeys"]
        default: return []
        }
    }
}

struct OfficialStreamsView: View {
    private let links: [(label: String, url: String)] = [
        ("ESPN Live", "https://www.espn.com/watch/"),
        ("NBA League Pass", "https://www.nba.com/watch/league-pass-stream"),
        ("NFL+", "https://www.nfl.com/plus/"),
        ("MLB.TV", "https://www.mlb.com/live-stream-games/"),
        ("WNBA League Pass", "https://www.wnba.com/leaguepass/")
    ]

    var body: some View {
        ZStack {
            EliteBackground()
            ScrollView {
                VStack(spacing: 12) {
                    ElitePanel {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Official Stream Center")
                                .font(.title3.bold())
                                .foregroundColor(.white)
                            Text("Use legal stream providers tied to your subscriptions.")
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.8))
                        }
                    }
                    .padding(.horizontal)

                    ForEach(links, id: \.url) { item in
                        NavigationLink(destination: InAppBrowserView(urlString: item.url)) {
                            ElitePanel {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(item.label)
                                            .font(.headline)
                                            .foregroundColor(.white)
                                        Text(item.url)
                                            .font(.caption2)
                                            .foregroundColor(.cyan.opacity(0.85))
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                    Image(systemName: "safari")
                                        .foregroundColor(.orange)
                                }
                            }
                            .padding(.horizontal)
                        }
                        .buttonStyle(PlainButtonStyle())
                    }
                }
                .padding(.top, 12)
                .padding(.bottom, 20)
            }
        }
        .navigationTitle("Streams")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct InAppBrowserView: UIViewControllerRepresentable {
    let urlString: String

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let url = URL(string: urlString) ?? URL(string: "https://www.espn.com/watch/")!
        let vc = SFSafariViewController(url: url)
        vc.preferredBarTintColor = UIColor.black
        vc.preferredControlTintColor = UIColor.orange
        return vc
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
