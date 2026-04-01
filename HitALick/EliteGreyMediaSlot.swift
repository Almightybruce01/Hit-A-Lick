import SwiftUI

/// Empty neutral slot when headshot / logo URL is missing or image fails (premium, no generated avatars).
struct EliteGreyMediaSlot: View {
    var size: CGFloat = 46
    var cornerFraction: CGFloat = 0.26

    var body: some View {
        let r = size * cornerFraction
        RoundedRectangle(cornerRadius: r, style: .continuous)
            .fill(Color(red: 0.16, green: 0.18, blue: 0.24))
            .overlay(
                RoundedRectangle(cornerRadius: r, style: .continuous)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )
            .frame(width: size, height: size)
    }
}
