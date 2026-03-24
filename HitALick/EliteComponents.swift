import SwiftUI

struct EliteBackground: View {
    var body: some View {
        ZStack {
            GifImage("spacebackground2")
                .scaleEffect(1.25)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            RadialGradient(
                colors: [
                    Color.cyan.opacity(0.25),
                    Color.clear
                ],
                center: .topLeading,
                startRadius: 30,
                endRadius: 420
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            RadialGradient(
                colors: [
                    Color.purple.opacity(0.22),
                    Color.clear
                ],
                center: .bottomTrailing,
                startRadius: 40,
                endRadius: 440
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            LinearGradient(
                colors: [
                    Color.blue.opacity(0.22),
                    Color.purple.opacity(0.08),
                    Color.black.opacity(0.44)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)
        }
    }
}

struct ElitePanel<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(12)
            .background(
                LinearGradient(
                    colors: [Color.white.opacity(0.11), Color.white.opacity(0.04)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.white.opacity(0.18), lineWidth: 1)
            )
            .cornerRadius(12)
            .shadow(color: .black.opacity(0.24), radius: 18, x: 0, y: 10)
    }
}

struct MetricChip: View {
    let title: String
    let value: String
    let isPositive: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .bold))
                .foregroundColor(.white.opacity(0.58))
            Text(value)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(isPositive ? .green.opacity(0.95) : .white.opacity(0.92))
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background(Color.white.opacity(0.08))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.white.opacity(0.16), lineWidth: 1)
        )
        .cornerRadius(8)
    }
}

struct SparklineChart: View {
    let values: [Double]

    var body: some View {
        GeometryReader { geo in
            let valid = values.filter { $0.isFinite }
            if valid.count < 2 {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.white.opacity(0.06))
            } else {
                let minV = valid.min() ?? 0
                let maxV = valid.max() ?? 1
                let span = max(0.0001, maxV - minV)
                let width = geo.size.width
                let height = geo.size.height
                Path { path in
                    for (idx, val) in valid.enumerated() {
                        let x = (CGFloat(idx) / CGFloat(max(1, valid.count - 1))) * width
                        let y = height - ((CGFloat((val - minV) / span)) * height)
                        if idx == 0 {
                            path.move(to: CGPoint(x: x, y: y))
                        } else {
                            path.addLine(to: CGPoint(x: x, y: y))
                        }
                    }
                }
                .stroke(Color.cyan.opacity(0.95), style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
            }
        }
        .frame(height: 58)
    }
}

struct BarStripChart: View {
    let values: [Double]

    var body: some View {
        let valid = values.filter { $0.isFinite }
        let minV = valid.min() ?? 0
        let maxV = valid.max() ?? 1
        let span = max(0.0001, maxV - minV)

        HStack(alignment: .bottom, spacing: 4) {
            ForEach(Array(valid.prefix(14).enumerated()), id: \.offset) { idx, value in
                let h = CGFloat(10 + ((value - minV) / span) * 54)
                RoundedRectangle(cornerRadius: 4)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.purple.opacity(0.9),
                                Color.cyan.opacity(0.9)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(width: 9, height: h)
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(Color.white.opacity(0.22), lineWidth: 0.8)
                    )
                    .animation(.easeOut(duration: 0.35).delay(Double(idx) * 0.02), value: h)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 64, maxHeight: 64, alignment: .bottomLeading)
    }
}

struct GlassPrimaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundColor(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(
                    LinearGradient(
                        colors: [Color.cyan, Color.green.opacity(0.85)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .cornerRadius(10)
        }
    }
}

struct SkeletonBlock: View {
    @State private var shimmer = false

    var body: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(Color.white.opacity(0.1))
            .overlay(
                LinearGradient(
                    colors: [Color.clear, Color.white.opacity(0.22), Color.clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .offset(x: shimmer ? 220 : -220)
            )
            .frame(height: 110)
            .onAppear {
                withAnimation(.linear(duration: 1.1).repeatForever(autoreverses: false)) {
                    shimmer = true
                }
            }
    }
}

struct EmptyStateCard: View {
    let title: String
    let message: String

    var body: some View {
        ElitePanel {
            VStack(spacing: 8) {
                Text(title)
                    .font(.headline)
                    .foregroundColor(.white)
                Text(message)
                    .font(.caption)
                    .multilineTextAlignment(.center)
                    .foregroundColor(.white.opacity(0.75))
            }
            .frame(maxWidth: .infinity)
        }
    }
}
