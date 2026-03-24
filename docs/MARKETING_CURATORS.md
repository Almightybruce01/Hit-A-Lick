# Curator marketing copy (Bruce + Giap)

- **Two named lanes**: **Bruce Pick’s** (main admin) and **Giap Pick’s** (co-curator). Boards are fed from the **universal pick pool** (owner-managed). Curators **select** which pool rows appear as “upcoming.” Settled results go to **history** only for legs that were logged.

- **Single-curator passes**: Stripe tiers `curator_giap`, `curator_bruce`; webhook stores the slug in `stripeSubscriptions` and `entitlement.curatorIds`.

- **Bundle**: `all_curators` unlocks both Bruce and Giap in-app.
