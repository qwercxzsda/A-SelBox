"""Saved acquisition lookup validates its identity before acquiring a connection."""

import unittest
from typing import cast
from unittest.mock import MagicMock
from uuid import uuid7

from ....src.archives.serialization import data_kiosk_payload, settlement_payload
from ....src.database.acquisitions import load_data_kiosk_acquisition, load_settlement_acquisition
from ....src.database.connection import DatabaseConnection
from ...support.archives import MemoryArchiveStorage
from ...support.economics import complete_economics_document
from ...support.source_preprocessing import (
    kiosk_acquisition,
    settlement_acquisition,
    settlement_document,
)


class TestAcquisitionReads(unittest.TestCase):
    @staticmethod
    def database_with_row(row: object) -> tuple[MagicMock, MagicMock]:
        database = MagicMock(spec=DatabaseConnection)
        connection = database.connection.return_value.__enter__.return_value
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = row
        return database, cursor

    def test_uuid_and_text_ids_load_the_same_unchanged_saved_manifest(self) -> None:
        storage = MemoryArchiveStorage()
        settlement = settlement_acquisition(settlement_document({}), storage)
        kiosk = kiosk_acquisition(storage, complete_economics_document())
        for acquisition, payload, load in (
            (settlement, settlement_payload(settlement), load_settlement_acquisition),
            (kiosk, data_kiosk_payload(kiosk), load_data_kiosk_acquisition),
        ):
            for identifier in (acquisition.id, str(acquisition.id)):
                with self.subTest(
                    source=type(acquisition).__name__, identifier_type=type(identifier)
                ):
                    database, cursor = self.database_with_row(payload)
                    self.assertEqual(load(database, identifier), acquisition)
                    self.assertEqual(cursor.execute.call_args.args[1], (str(acquisition.id),))

    def test_non_uuid_values_do_not_open_a_connection_or_invent_identifiers(self) -> None:
        for load in (load_settlement_acquisition, load_data_kiosk_acquisition):
            for invalid in (None, True, 11111111111111111111111111111111, "invalid"):
                database = MagicMock(spec=DatabaseConnection)
                with self.subTest(load=load.__name__, invalid=invalid):
                    with self.assertRaises((TypeError, ValueError)):
                        load(database, cast(str, invalid))
                    database.connection.assert_not_called()

    def test_missing_saved_acquisition_is_not_synthesized(self) -> None:
        for load in (load_settlement_acquisition, load_data_kiosk_acquisition):
            database, _ = self.database_with_row(None)
            with self.subTest(load=load.__name__), self.assertRaises(LookupError):
                load(database, uuid7())
