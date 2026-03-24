import SwiftUI
import FirebaseAuth

struct ContentView: View {
    @AppStorage("isUserLoggedIn") var isUserLoggedIn: Bool = false
    @State private var navigateTo: Int? = nil
    @State private var page = 0
    @State private var phase: CGFloat = 0
    @State private var progress: CGFloat = 0

    private let timer = Timer.publish(every: 0.04, on: .main, in: .common).autoconnect()
    private let pageCount = 5

    var body: some View {
        NavigationStack {
            Group {
                if isUserLoggedIn {
                    HomeScreen()
                } else {
                    onboardingView
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var onboardingView: some View {
        ZStack {
            movingBackground
                .ignoresSafeArea()

            VStack(spacing: 14) {
                progressBars
                    .padding(.top, 8)

                TabView(selection: $page) {
                    pageCard(
                        title: "Execute Seamlessly.",
                        subtitle: "Effortlessly place insights into action across your favorite books.",
                        icon: "bolt.fill"
                    )
                    .tag(0)

                    pageCard(
                        title: "Analyze the Markets.",
                        subtitle: "Use movement, confidence, and trend context to lock in cleaner reads.",
                        icon: "chart.xyaxis.line"
                    )
                    .tag(1)

                    pageCard(
                        title: "Maximize Upside.",
                        subtitle: "Compare available prices and books to find the sharpest number.",
                        icon: "arrow.up.forward.circle.fill"
                    )
                    .tag(2)

                    pageCard(
                        title: "Explore Games + Props.",
                        subtitle: "Scan player props, game lines, and pick intelligence in one feed.",
                        icon: "sportscourt.fill"
                    )
                    .tag(3)

                    pageCard(
                        title: "Elite Insights, Daily.",
                        subtitle: "Real-time panels, AI engine, and premium boards with your branding.",
                        icon: "sparkles"
                    )
                    .tag(4)
                }
                .tabViewStyle(PageTabViewStyle(indexDisplayMode: .never))
                .frame(height: 530)

                authButtons

                Spacer(minLength: 8)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 16)
        }
        .onReceive(timer) { _ in
            phase += 0.002
            progress += 0.012
            if progress >= 1 {
                progress = 0
                withAnimation(.easeInOut(duration: 0.35)) {
                    page = (page + 1) % pageCount
                }
            }
        }
    }

    private var movingBackground: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.23, green: 0.82, blue: 0.74),
                    Color(red: 0.19, green: 0.56, blue: 0.95),
                    Color(red: 0.21, green: 0.35, blue: 0.95)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .hueRotation(.degrees(Double(phase) * 40))

            Circle()
                .fill(Color.white.opacity(0.12))
                .frame(width: 280, height: 280)
                .blur(radius: 14)
                .offset(x: -130 + sin(phase * 8) * 36, y: -250)

            Circle()
                .fill(Color.cyan.opacity(0.14))
                .frame(width: 320, height: 320)
                .blur(radius: 24)
                .offset(x: 130 + cos(phase * 7) * 40, y: 180)
        }
    }

    private var progressBars: some View {
        HStack(spacing: 8) {
            ForEach(0..<pageCount, id: \.self) { idx in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.black.opacity(0.28)).frame(height: 4)
                    Capsule()
                        .fill(Color.white.opacity(0.95))
                        .frame(width: progressWidth(for: idx), height: 4)
                }
            }
        }
    }

    private func progressWidth(for idx: Int) -> CGFloat {
        let full: CGFloat = 58
        if idx < page { return full }
        if idx == page { return full * progress }
        return 0
    }

    private func pageCard(title: String, subtitle: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(Color.black.opacity(0.74))
                    .overlay(
                        RoundedRectangle(cornerRadius: 22)
                            .stroke(Color.white.opacity(0.14), lineWidth: 1)
                    )
                    .shadow(color: .black.opacity(0.45), radius: 16, y: 8)

                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("Market Card", systemImage: icon)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.white.opacity(0.88))
                        Spacer()
                        Text("LIVE")
                            .font(.system(size: 10, weight: .bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.green.opacity(0.18))
                            .clipShape(Capsule())
                            .foregroundColor(.green)
                    }

                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.white.opacity(0.09))
                            .frame(height: 40)
                            .overlay(
                                HStack {
                                    Circle().fill(Color.cyan.opacity(0.65)).frame(width: 7, height: 7)
                                    Rectangle().fill(Color.white.opacity(0.35)).frame(height: 8)
                                    Spacer(minLength: 0)
                                }
                                .padding(.horizontal, 10)
                            )
                    }
                }
                .padding(14)
            }
            .frame(height: 210)
            .rotationEffect(.degrees(Double(sin(phase * 10)) * 2.4))
            .offset(y: sin(phase * 9) * 6)

            Text(title)
                .font(.system(size: 44, weight: .heavy))
                .foregroundColor(.white)
                .minimumScaleFactor(0.8)

            Text(subtitle)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(.white.opacity(0.62))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var authButtons: some View {
        VStack(spacing: 10) {
            Button(action: { navigateTo = 1 }) {
                Label("Continue with phone", systemImage: "phone.fill")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color.black.opacity(0.95))
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
            }
            .background(
                NavigationLink(destination: PhoneLogin(), tag: 1, selection: $navigateTo) { EmptyView() }.hidden()
            )

            HStack(spacing: 10) {
                smallAuthButton(system: "envelope.fill", tag: 2, destination: AnyView(EmailLogin()))
                smallAuthButton(system: "apple.logo", tag: 4, destination: AnyView(AppleLogin()))
                smallAuthButton(text: "G", tag: 3, destination: AnyView(GmailLogin()))
            }

            Text("By continuing, you agree to our Privacy Policy and Terms of Use.")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.white.opacity(0.7))
                .multilineTextAlignment(.center)
        }
    }

    private func smallAuthButton(system: String? = nil, text: String? = nil, tag: Int, destination: AnyView) -> some View {
        Button(action: { navigateTo = tag }) {
            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(Color.blue.opacity(0.34))
                    .overlay(
                        RoundedRectangle(cornerRadius: 22).stroke(Color.white.opacity(0.18), lineWidth: 1)
                    )
                    .frame(height: 48)
                if let system = system {
                    Image(systemName: system)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(.white)
                } else if let text = text {
                    Text(text)
                        .font(.system(size: 23, weight: .heavy))
                        .foregroundColor(.white)
                }
            }
        }
        .background(
            NavigationLink(destination: destination, tag: tag, selection: $navigateTo) { EmptyView() }.hidden()
        )
    }
}
