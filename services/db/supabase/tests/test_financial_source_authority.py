"""Category authority counts only real source components without double-counting."""

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.transaction_fixtures import TransactionPageFixture


class FinancialSourceAuthorityTests(TransactionPageFixture):
    def test_payout_cutoff_uses_two_calendar_months_in_every_session_timezone(self) -> None:
        expected = require_row(
            self.connection.execute(
                "select ((current_timestamp at time zone 'UTC')::date - interval '2 months')::date"
            ).fetchone()
        )[0]
        for timezone in ("Pacific/Kiritimati", "Pacific/Honolulu", "UTC"):
            self.connection.execute("select set_config('TimeZone',%s,true)", (timezone,))
            self.assertEqual(self.mature_cutoff_date(), expected)
