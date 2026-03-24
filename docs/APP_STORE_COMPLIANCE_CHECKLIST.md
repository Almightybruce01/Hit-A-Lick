# HitALick App Store Compliance Checklist

## Scope
This checklist ensures HitALick remains an informational analytics companion app and does not cross into betting or simulated betting behavior.

## Product Behavior
- No in-app purchase collection for subscriptions.
- No links or UI that execute in-app checkout.
- No bet placement, bankroll tracking, or wagering game loops.
- No simulated betting mechanics (virtual chips, fake stake systems, or payout simulation).
- iOS unlocks premium content only after authenticated entitlement verification.

## Copy and Messaging
- App copy uses analytics language: trends, projections, filters, insights.
- Avoid calls-to-action like "place bet", "lock a bet", or "stack cash".
- Include informational-use disclaimer in onboarding and settings.
- Keep web-only subscription messaging explicit where relevant.

## Technical Controls
- Entitlements sourced from backend (`users/{uid}.entitlement`) only.
- Stripe webhooks are server-side and never run in-app.
- Premium gating is feature-based (content unlock), not purchase-flow based in iOS.
- All purchase management lives on `hitalick.org`.

## Submission Readiness
- App review notes explain web-originated subscription model.
- Screenshots do not show betting or simulated wagering flows.
- Metadata and keyword fields avoid gambling-promotional language.
- Privacy policy and terms clearly state informational analytics purpose.
