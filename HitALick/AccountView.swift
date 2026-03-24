






import SwiftUI
import FirebaseAuth

struct AccountView: View {
    @AppStorage("isUserLoggedIn") var isUserLoggedIn: Bool = false
    @AppStorage("hitalick_tier") private var tierRaw: String = UserTier.core.rawValue
    @State private var glow = false
    @State private var userEmail = "Guest"
    @State private var userUid = "-"
    @State private var selectedSection = "Account"
    @State private var curatorMe: CuratorMeResponse?
    @State private var curatorMeStatus: String?
#if DEBUG
    @State private var apiBaseDraft = ""
    @State private var apiOverrideMessage: String?
#endif

    private let sections = ["Account", "Analytics", "Membership", "Support"]

    var body: some View {
        ZStack {
            GifImage("spacebackground2")
                .scaleEffect(1.3)
                .ignoresSafeArea()
                .allowsHitTesting(false)
            LinearGradient(
                colors: [
                    Color.blue.opacity(glow ? 0.28 : 0.08),
                    Color.purple.opacity(0.05),
                    Color.black.opacity(0.4)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 16) {
                    VStack(spacing: 10) {
                        Image("HitALicklogo")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 88, height: 88)
                            .clipShape(RoundedRectangle(cornerRadius: 18))
                            .overlay(
                                RoundedRectangle(cornerRadius: 18)
                                    .stroke(Color.orange.opacity(0.45), lineWidth: 1.2)
                            )

                        Text("HitALick Account")
                            .font(.title2.bold())
                            .foregroundColor(.white)

                        Text("Control your access, preferences, and subscriber experience.")
                            .font(.footnote)
                            .multilineTextAlignment(.center)
                            .foregroundColor(.white.opacity(0.72))
                            .padding(.horizontal, 20)
                    }
                    .padding(.top, 22)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Profile")
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.7))

                        HStack {
                            Image(systemName: "person.crop.circle.fill")
                                .foregroundColor(.orange)
                            Text(userEmail)
                                .foregroundColor(.white)
                                .font(.subheadline.weight(.semibold))
                        }

                        HStack {
                            Image(systemName: "number")
                                .foregroundColor(.blue)
                            Text("UID: \(userUid)")
                                .foregroundColor(.white.opacity(0.75))
                                .font(.caption)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.black.opacity(0.35))
                    .cornerRadius(16)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(sections, id: \.self) { section in
                                Button {
                                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                                        selectedSection = section
                                    }
                                } label: {
                                    Text(section)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundColor(selectedSection == section ? .black : .white)
                                        .padding(.vertical, 8)
                                        .padding(.horizontal, 12)
                                        .background(
                                            selectedSection == section
                                                ? Color.orange
                                                : Color.white.opacity(0.12)
                                        )
                                        .cornerRadius(999)
                                }
                            }
                        }
                    }

                    VStack(spacing: 10) {
                        accountRow(title: "Personal Info", icon: "person.text.rectangle")
                        accountRow(title: "Analytics Preferences", icon: "slider.horizontal.3")
                        accountRow(title: "Membership Status", icon: "creditcard")
                        accountRow(title: "Support Center", icon: "message")
                    }
                    .padding()
                    .background(Color.black.opacity(0.35))
                    .cornerRadius(16)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Tier + Entitlements")
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.7))
                        Picker("Tier", selection: $tierRaw) {
                            Text("Core").tag(UserTier.core.rawValue)
                            Text("Pro").tag(UserTier.pro.rawValue)
                            Text("Elite").tag(UserTier.elite.rawValue)
                        }
                        .pickerStyle(SegmentedPickerStyle())
                        Text("Controls feature access for chart stack, premium boards, pick studio, and stream center.")
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.78))
                    }
                    .padding()
                    .background(Color.black.opacity(0.35))
                    .cornerRadius(16)

                    curatorStudioSection

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Referral")
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.7))
                        Text("Invite your friends to unlock smarter analytics.")
                            .foregroundColor(.white.opacity(0.9))
                            .font(.footnote)
                        Button(action: {}) {
                            Text("Share Referral Code")
                                .foregroundColor(.orange)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.orange.opacity(0.18))
                                .cornerRadius(12)
                        }
                    }
                    .padding()
                    .background(Color.black.opacity(0.35))
                    .cornerRadius(16)

#if DEBUG
                    developerAPIBaseSection
#endif

                    Button("Log Out") {
                        try? Auth.auth().signOut()
                        isUserLoggedIn = false
                    }
                    .foregroundColor(.red)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity)
                    .background(Color.red.opacity(0.12))
                    .cornerRadius(12)
                }
                .padding(.horizontal)
                .padding(.bottom, 28)
            }
        }
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .screenEntrance()
        .task(id: userUid) {
            await loadCuratorMe()
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
                glow.toggle()
            }
            if let user = Auth.auth().currentUser {
                userEmail = user.email ?? "Signed in"
                userUid = user.uid
            } else {
                userEmail = "Not signed in"
                userUid = "-"
                curatorMe = nil
            }
#if DEBUG
            apiBaseDraft = UserDefaults.standard.string(forKey: APIConfig.baseURLKey) ?? ""
#endif
        }
    }

    private var shouldShowCuratorStudio: Bool {
        guard userUid != "-" else { return false }
        if let s = curatorMeStatus, !s.isEmpty { return true }
        guard let me = curatorMe else { return false }
        if me.isOwner == true { return true }
        if let slug = me.curatorId, !slug.isEmpty { return true }
        return false
    }

    @ViewBuilder
    private var curatorStudioSection: some View {
        if shouldShowCuratorStudio {
            VStack(alignment: .leading, spacing: 12) {
                Text("Curator Studio (elite)")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.7))
                Text("Publish featured parlays, profile photo, and background art to your Premium tab board.")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.72))

                if let me = curatorMe, me.isOwner == true {
                    Text("Owner: open any lane")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.orange.opacity(0.95))
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(["bruce", "giap"], id: \.self) { slug in
                            NavigationLink {
                                CuratorStudioView(curatorSlug: slug)
                            } label: {
                                HStack {
                                    Image(systemName: "slider.horizontal.3")
                                        .foregroundColor(.cyan)
                                    Text(slugLabel(slug))
                                        .foregroundColor(.white)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .foregroundColor(.white.opacity(0.45))
                                }
                                .padding(.vertical, 6)
                            }
                        }
                    }
                } else if let slug = curatorMe?.curatorId, !slug.isEmpty {
                    NavigationLink {
                        CuratorStudioView(curatorSlug: slug)
                    } label: {
                        HStack {
                            Image(systemName: "person.crop.rectangle.stack")
                                .foregroundColor(.orange)
                            Text("Open \(curatorMe?.curatorDisplayName ?? slugLabel(slug))")
                                .foregroundColor(.white)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.white.opacity(0.45))
                        }
                        .padding(.vertical, 8)
                    }
                } else if let curatorMeStatus {
                    Text(curatorMeStatus)
                        .font(.caption2)
                        .foregroundColor(.yellow.opacity(0.85))
                }
            }
            .padding()
            .background(Color.black.opacity(0.35))
            .cornerRadius(16)
        }
    }

    private func slugLabel(_ slug: String) -> String {
        switch slug.lowercased() {
        case "giap": return "Giap Pick's"
        case "bruce": return "Bruce Pick's"
        default: return slug.uppercased()
        }
    }

    @MainActor
    private func loadCuratorMe() async {
        curatorMeStatus = nil
        guard let user = Auth.auth().currentUser else {
            curatorMe = nil
            return
        }
        do {
            let token = try await user.getIDToken()
            let url = URL(string: "\(APIConfig.baseURL)/api/curators/me?uid=\(user.uid)")!
            var req = URLRequest(url: url)
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                let body = String(data: data, encoding: .utf8) ?? ""
                curatorMe = nil
                curatorMeStatus = "Curator lookup failed: \(body)"
                return
            }
            curatorMe = try JSONDecoder().decode(CuratorMeResponse.self, from: data)
        } catch {
            curatorMe = nil
            curatorMeStatus = error.localizedDescription
        }
    }

#if DEBUG
    private var developerAPIBaseSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Developer — API base URL")
                .font(.caption)
                .foregroundColor(.yellow.opacity(0.95))
            Text("Debug builds only. Leave empty for production. Applies immediately after Save.")
                .font(.caption2)
                .foregroundColor(.white.opacity(0.65))
            TextField("https://… (empty = production)", text: $apiBaseDraft)
                .textContentType(.URL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(10)
                .background(Color.white.opacity(0.08))
                .cornerRadius(10)
                .foregroundColor(.white)
            HStack(spacing: 10) {
                Button("Save") {
                    let t = apiBaseDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                    if t.isEmpty {
                        APIConfig.clearBaseURLOverride()
                        apiOverrideMessage = "Using production: \(APIConfig.productionBaseURL)"
                    } else if URL(string: t)?.host != nil {
                        APIConfig.setBaseURLOverride(t)
                        apiOverrideMessage = "Saved. Effective: \(APIConfig.baseURL)"
                    } else {
                        apiOverrideMessage = "Invalid URL — need https host."
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.orange)
                Button("Reset") {
                    apiBaseDraft = ""
                    APIConfig.clearBaseURLOverride()
                    apiOverrideMessage = "Reset to production."
                }
                .foregroundColor(.white)
            }
            Text("Effective now: \(APIConfig.baseURL)")
                .font(.caption2)
                .foregroundColor(.cyan.opacity(0.95))
                .lineLimit(2)
                .minimumScaleFactor(0.85)
            if let apiOverrideMessage {
                Text(apiOverrideMessage)
                    .font(.caption2)
                    .foregroundColor(.green.opacity(0.9))
            }
        }
        .padding()
        .background(Color.yellow.opacity(0.12))
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.yellow.opacity(0.35), lineWidth: 1)
        )
    }
#endif

    @ViewBuilder
    private func accountRow(title: String, icon: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundColor(.orange)
                .frame(width: 18)
            Text(title)
                .foregroundColor(.white)
            Spacer()
            Image(systemName: "chevron.right")
                .foregroundColor(.white.opacity(0.45))
        }
        .padding(.vertical, 8)
    }
}
