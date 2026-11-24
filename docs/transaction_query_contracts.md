# Transaction reads

The transaction page, count and totals RPCs filter authorized company amounts over a UTC date range. Marketplace-local posting dates remain available for fees and payout reporting. Financial review uses separate administrator-only outcome views to show account costs and unresolved amounts.

Finances source pages expose immutable transaction components and observation provenance to administrators. Payout report records use the source and assignment versions pinned when the report was published. See the [frontend](../services/frontend/user-webpage/README.md) and [database migrations](../services/db/supabase/migrations/) for the current UI and RPC signatures.
