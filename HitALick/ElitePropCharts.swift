import SwiftUI
import Charts

/// Native Swift Charts (no paid SDK). For broker-grade candlesticks / TradingView embeds, use a WebView + their license.
struct PropEdgeBarChart: View {
    let edges: [PropEdge]

    private var rows: [(id: String, label: String, edge: Double)] {
        edges.prefix(10).enumerated().map { i, e in
            let lbl = (e.label ?? e.market ?? "Edge").trimmingCharacters(in: .whitespacesAndNewlines)
            let short = lbl.count > 28 ? String(lbl.prefix(28)) + "..." : lbl
            return (id: "\(i)_\(short)", label: short, edge: e.edgePct ?? 0)
        }
    }

    var body: some View {
        if rows.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("Model edge (top legs)")
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(.white.opacity(0.85))
                Chart(rows, id: \.id) { row in
                    BarMark(
                        x: .value("Edge %", row.edge),
                        y: .value("Leg", row.label)
                    )
                    .foregroundStyle(
                        LinearGradient(
                            colors: [
                                Color(red: 0.2, green: 0.95, blue: 0.85),
                                Color(red: 0.35, green: 0.55, blue: 1.0),
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .cornerRadius(4)
                }
                .chartXAxis {
                    AxisMarks(values: .automatic) { val in
                        AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                            .foregroundStyle(.white.opacity(0.12))
                        AxisValueLabel()
                            .foregroundStyle(.white.opacity(0.55))
                    }
                }
                .chartYAxis {
                    AxisMarks { _ in
                        AxisValueLabel()
                            .foregroundStyle(.white.opacity(0.65))
                    }
                }
                .frame(height: min(220, CGFloat(44 * max(3, rows.count))))
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color.black.opacity(0.35))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(
                            LinearGradient(
                                colors: [.cyan.opacity(0.35), .purple.opacity(0.25)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                )
            }
        }
    }
}
