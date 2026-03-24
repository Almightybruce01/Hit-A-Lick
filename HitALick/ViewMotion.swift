import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct ScreenEntranceModifier: ViewModifier {
    @State private var isVisible = false
    var duration: Double = 0.32

    func body(content: Content) -> some View {
        content
            .opacity(isVisible ? 1 : 0)
            .offset(y: isVisible ? 0 : 18)
            .scaleEffect(isVisible ? 1 : 0.985)
            .onAppear {
                withAnimation(.easeOut(duration: duration)) {
                    isVisible = true
                }
            }
    }
}

extension View {
    func screenEntrance(duration: Double = 0.32) -> some View {
        modifier(ScreenEntranceModifier(duration: duration))
    }
}

enum EliteHaptics {
    static func light() {
        #if canImport(UIKit)
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.prepare()
        generator.impactOccurred()
        #endif
    }

    static func medium() {
        #if canImport(UIKit)
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.prepare()
        generator.impactOccurred()
        #endif
    }

    static func success() {
        #if canImport(UIKit)
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.success)
        #endif
    }
}
