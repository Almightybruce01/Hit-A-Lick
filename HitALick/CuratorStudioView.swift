import SwiftUI
import PhotosUI
import FirebaseAuth

// MARK: - Elite Curator Studio (Bruce + Giap lanes; Bruce/owner can open both)
// Upload profile + background from device, publish featured parlays to subscriber boards.

struct CuratorStudioView: View {
    let curatorSlug: String

    @State private var displayName = ""
    @State private var accentHex = "#ff9f0a"
    @State private var backgroundHex = "#0a1227"
    @State private var photoItem: PhotosPickerItem?
    @State private var bgPhotoItem: PhotosPickerItem?
    @State private var photoDataUrl: String?
    @State private var backgroundImageDataUrl: String?
    @State private var status = ""
    @State private var isSaving = false
    @State private var parlayTitle = ""
    @State private var legRows: [LegDraft] = [LegDraft(), LegDraft()]
    @State private var parlayNote = ""

    private struct LegDraft: Identifiable {
        let id = UUID()
        var label = ""
        var oddsText = ""
    }

    var body: some View {
        ZStack {
            EliteBackground()

            ScrollView {
                VStack(spacing: 18) {
                    header
                    profileSection
                    parlaySection
                    tipsSection
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 20)
            }
        }
        .navigationTitle("Curator Studio")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadProfile()
        }
        .screenEntrance()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Lane: \(laneLabel)")
                .font(.title2.bold())
                .foregroundColor(.orange)
            Text("Customize your public board: profile photo, background image, hex theme, and featured parlays subscribers see in the Premium tab.")
                .font(.caption)
                .foregroundColor(.white.opacity(0.78))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var laneLabel: String {
        switch curatorSlug.lowercased() {
        case "giap": return "Giap Pick's"
        case "bruce": return "Bruce Pick's"
        default: return curatorSlug.uppercased()
        }
    }

    private var profileSection: some View {
        ElitePanel {
            VStack(alignment: .leading, spacing: 14) {
                Text("Branding & profile")
                    .font(.headline)
                    .foregroundColor(.white)

                TextField("Display name", text: $displayName)
                    .padding(10)
                    .background(Color.white.opacity(0.1))
                    .cornerRadius(10)
                    .foregroundColor(.white)

                HStack {
                    TextField("Accent #hex", text: $accentHex)
                    TextField("BG #hex", text: $backgroundHex)
                }
                .padding(10)
                .background(Color.white.opacity(0.08))
                .cornerRadius(10)
                .foregroundColor(.white)
                .font(.caption.monospaced())

                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Profile photo")
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.white.opacity(0.9))
                        PhotosPicker(selection: $photoItem, matching: .images) {
                            Label("Choose image", systemImage: "person.crop.circle.badge.plus")
                                .font(.caption.weight(.semibold))
                                .foregroundColor(.cyan)
                        }
                        .onChange(of: photoItem) { _, new in
                            Task { await loadDataUrl(from: new, into: \.photoDataUrl) }
                        }
                        dataUrlThumb(photoDataUrl)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Background image")
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.white.opacity(0.9))
                        PhotosPicker(selection: $bgPhotoItem, matching: .images) {
                            Label("Choose image", systemImage: "photo.on.rectangle.angled")
                                .font(.caption.weight(.semibold))
                                .foregroundColor(.mint)
                        }
                        .onChange(of: bgPhotoItem) { _, new in
                            Task { await loadDataUrl(from: new, into: \.backgroundImageDataUrl) }
                        }
                        dataUrlThumb(backgroundImageDataUrl)
                    }
                }

                GlassPrimaryButton(title: isSaving ? "Saving…" : "Save profile") {
                    Task { await saveProfile() }
                }
                .disabled(isSaving)
            }
        }
    }

    @ViewBuilder
    private func dataUrlThumb(_ dataUrl: String?) -> some View {
        if let dataUrl, let ui = UIImage(dataUrlFromString(dataUrl)) {
            Image(uiImage: ui)
                .resizable()
                .scaledToFill()
                .frame(width: 96, height: 96)
                .clipped()
                .cornerRadius(12)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.2), lineWidth: 1))
        } else {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(0.08))
                .frame(width: 96, height: 96)
                .overlay(Image(systemName: "photo").foregroundColor(.white.opacity(0.35)))
        }
    }

    private var parlaySection: some View {
        ElitePanel {
            VStack(alignment: .leading, spacing: 14) {
                Text("Featured parlay (subscriber view)")
                    .font(.headline)
                    .foregroundColor(.white)
                Text("Publishes to your curator showcase. Fans see it on the Premium tab with their subscription.")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.72))

                TextField("Parlay title", text: $parlayTitle)
                    .padding(10)
                    .background(Color.white.opacity(0.1))
                    .cornerRadius(10)
                    .foregroundColor(.white)

                ForEach($legRows) { $row in
                    HStack(spacing: 8) {
                        TextField("Leg label (e.g. Lakers -4.5)", text: $row.label)
                        TextField("Odds", text: $row.oddsText)
                            .keyboardType(.numbersAndPunctuation)
                            .frame(width: 72)
                    }
                    .padding(8)
                    .background(Color.black.opacity(0.25))
                    .cornerRadius(8)
                    .foregroundColor(.white)
                    .font(.caption)
                }

                Button {
                    legRows.append(LegDraft())
                } label: {
                    Label("Add leg", systemImage: "plus.circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.orange)
                }

                TextField("Notes (optional)", text: $parlayNote, axis: .vertical)
                    .lineLimit(2...5)
                    .padding(10)
                    .background(Color.white.opacity(0.08))
                    .cornerRadius(10)
                    .foregroundColor(.white)

                GlassPrimaryButton(title: isSaving ? "Publishing…" : "Publish parlay") {
                    Task { await publishParlay() }
                }
                .disabled(isSaving)
            }
        }
    }

    private var tipsSection: some View {
        ElitePanel {
            VStack(alignment: .leading, spacing: 10) {
                Text("Ops tips")
                    .font(.headline)
                    .foregroundColor(.white)
                Text("• Pool rows must be added by the site owner (universal pool). You select picks from the pool for your board.\n• Large images are compressed server-side by size limit — keep photos under ~5MP before pick.\n• Parlays are educational; users verify on their sportsbook.")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.72))
            }
        }
    }

    private func dataUrlFromString(_ s: String) -> Data {
        if s.hasPrefix("data:"), let comma = s.firstIndex(of: ",") {
            let b64 = String(s[s.index(after: comma)...])
            return Data(base64Encoded: b64) ?? Data()
        }
        return Data()
    }

    private func loadDataUrl(from item: PhotosPickerItem?, into keyPath: ReferenceWritableKeyPath<CuratorStudioView, String?>) async {
        guard let item else { return }
        do {
            if let data = try await item.loadTransferable(type: Data.self) {
                let compressed = compressImageData(data, maxBytes: 420_000)
                let b64 = compressed.base64EncodedString()
                await MainActor.run {
                    self[keyPath: keyPath] = "data:image/jpeg;base64,\(b64)"
                }
            }
        } catch {
            await MainActor.run { status = "Image load failed: \(error.localizedDescription)" }
        }
    }

    private func compressImageData(_ data: Data, maxBytes: Int) -> Data {
        guard let ui = UIImage(data: data) else { return data }
        var q: CGFloat = 0.82
        var out = data
        for _ in 0..<8 {
            if let j = ui.jpegData(compressionQuality: q) {
                out = j
                if out.count <= maxBytes { break }
                q -= 0.1
            } else { break }
        }
        return out
    }

    @MainActor
    private func loadProfile() async {
        guard let user = Auth.auth().currentUser else {
            status = "Sign in required."
            return
        }
        do {
            let token = try await user.getIDToken()
            let url = URL(string: "\(APIConfig.baseURL)/api/curators/\(curatorSlug)/profile")!
            var req = URLRequest(url: url)
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (data, _) = try await URLSession.shared.data(for: req)
            let decoded = try JSONDecoder().decode(CuratorProfilePublic.self, from: data)
            displayName = decoded.displayName ?? laneLabel
            accentHex = decoded.accentHex ?? "#ff9f0a"
            backgroundHex = decoded.backgroundHex ?? "#0a1227"
            photoDataUrl = decoded.photoDataUrl
            backgroundImageDataUrl = decoded.backgroundImageDataUrl
        } catch {
            status = "Profile load: \(error.localizedDescription)"
        }
    }

    private struct CuratorProfilePublic: Decodable {
        let displayName: String?
        let photoDataUrl: String?
        let backgroundImageDataUrl: String?
        let accentHex: String?
        let backgroundHex: String?
    }

    @MainActor
    private func saveProfile() async {
        guard let user = Auth.auth().currentUser else {
            status = "Sign in required."
            return
        }
        isSaving = true
        defer { isSaving = false }
        do {
            let token = try await user.getIDToken()
            let url = URL(string: "\(APIConfig.baseURL)/api/curators/\(curatorSlug)/profile")!
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let payload: [String: Any] = [
                "uid": user.uid,
                "displayName": displayName,
                "accentHex": accentHex,
                "backgroundHex": backgroundHex,
                "photoDataUrl": photoDataUrl ?? "",
                "backgroundImageDataUrl": backgroundImageDataUrl ?? "",
            ]
            req.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (_, res) = try await URLSession.shared.data(for: req)
            guard let http = res as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NSError(domain: "Studio", code: 500)
            }
            status = "Profile saved."
            EliteHaptics.medium()
        } catch {
            status = "Save failed: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func publishParlay() async {
        guard let user = Auth.auth().currentUser else {
            status = "Sign in required."
            return
        }
        let legs: [[String: Any]] = legRows.compactMap { row in
            let odds = Int(row.oddsText.trimmingCharacters(in: .whitespaces)) ?? 0
            let label = row.label.trimmingCharacters(in: .whitespaces)
            if label.isEmpty { return nil }
            return ["label": label, "odds": odds]
        }
        guard !legs.isEmpty, !parlayTitle.trimmingCharacters(in: .whitespaces).isEmpty else {
            status = "Add a title and at least one leg with odds."
            return
        }
        isSaving = true
        defer { isSaving = false }
        do {
            let token = try await user.getIDToken()
            let url = URL(string: "\(APIConfig.baseURL)/api/curators/\(curatorSlug)/parlays")!
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let payload: [String: Any] = [
                "uid": user.uid,
                "title": parlayTitle,
                "legs": legs,
                "note": parlayNote,
                "published": true,
            ]
            req.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (_, res) = try await URLSession.shared.data(for: req)
            guard let http = res as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NSError(domain: "Studio", code: 500)
            }
            status = "Parlay published to your board."
            parlayTitle = ""
            parlayNote = ""
            legRows = [LegDraft(), LegDraft()]
            EliteHaptics.success()
        } catch {
            status = "Parlay publish failed: \(error.localizedDescription)"
        }
    }
}
