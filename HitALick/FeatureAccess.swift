import Foundation

enum UserTier: String, CaseIterable {
    case core
    case pro
    case elite

    var rank: Int {
        switch self {
        case .core: return 0
        case .pro: return 1
        case .elite: return 2
        }
    }

    var label: String { rawValue.uppercased() }
}

enum FeatureGate: String {
    case premiumBoards
    case alertGraph
    case pickStudio
    case streamCenter

    var minimumTier: UserTier {
        switch self {
        case .premiumBoards: return .pro
        case .alertGraph: return .pro
        case .pickStudio: return .elite
        case .streamCenter: return .pro
        }
    }
}

func hasAccess(tier: UserTier, feature: FeatureGate) -> Bool {
    tier.rank >= feature.minimumTier.rank
}

