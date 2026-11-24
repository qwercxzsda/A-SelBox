"""Source facts cross the database boundary with valid fee inputs and categories."""

from services.db.supabase.tests.source_fixtures import SourceModelFixture


class PreprocessValidationTests(SourceModelFixture):
    def test_fee_bearing_finances_rows_require_marketplace_and_posting_date(self) -> None:
        for field, error in (
            ("marketplace_name", ValueError),
            ("posted_date", ValueError),
        ):
            with self.subTest(field=field), self.assertRaises(error), self.connection.transaction():
                self.finances([self.transaction("100") | {field: None}])
        self.assertEqual(
            self.connection.execute("select count(*) from private.source_units").fetchone(),
            (0,),
        )
