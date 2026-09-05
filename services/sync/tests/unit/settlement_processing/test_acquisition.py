"""Tests for transient auxiliary-source acquisition."""

import gzip
import unittest
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast
from unittest.mock import Mock, call, patch
from uuid import uuid4

from ....src.amazon.auxiliary_fees import AuxiliaryFeeBatch, AuxiliaryFeeSource
from ....src.amazon.fba_reports.lifecycle import FbaReportsClient
from ....src.amazon.reports.models import DownloadedReportDocument
from ....src.settlement_processing.acquisition import (
    AuxiliaryAcquisitionSettings,
    AuxiliaryClients,
    acquire_auxiliary_observations,
)
from ....src.settlement_processing.artifacts import ProcessingArtifactLog
from ....src.settlement_processing.models import AuxiliaryRequirements
from ....src.settlement_processing.raw_report import prepare_settlement_report
from ...support.settlement_processing import stored_settlement_report


class TestAuxiliaryAcquisition(unittest.TestCase):
    def test_reuses_each_decompressed_fba_document_for_artifact_and_parser(self) -> None:
        settlement = prepare_settlement_report(
            stored_settlement_report(),
            id_factory=lambda: str(uuid4()),
        )
        marketplace_id = settlement.header.marketplace_ids[0]
        aged_bytes = b"decoded aged-storage document"
        removal_bytes = b"decoded removal document"
        aged_document = DownloadedReportDocument(
            transferred_content=gzip.compress(aged_bytes),
            compression_algorithm="GZIP",
        )
        removal_document = DownloadedReportDocument(
            transferred_content=gzip.compress(removal_bytes),
            compression_algorithm="GZIP",
        )
        downloaded_aged = Mock(document=aged_document, report_summary=Mock())
        downloaded_removal = Mock(document=removal_document, report_summary=Mock())
        aged_batch = AuxiliaryFeeBatch(
            settlement_report_id=settlement.report.id,
            source_system=AuxiliaryFeeSource.FBA_REPORT,
            seller_namespace=settlement.header.seller_namespace,
            amazon_scope=settlement.header.amazon_scope,
            marketplace_id=marketplace_id,
            source_start_date=settlement.header.settlement_start_date,
            source_end_date=settlement.header.settlement_end_date,
        )
        removal_batch = AuxiliaryFeeBatch(
            settlement_report_id=settlement.report.id,
            source_system=AuxiliaryFeeSource.FBA_REPORT,
            seller_namespace=settlement.header.seller_namespace,
            amazon_scope=settlement.header.amazon_scope,
            marketplace_id=marketplace_id,
            source_start_date=settlement.header.settlement_start_date,
            source_end_date=settlement.header.settlement_end_date,
        )

        with (
            TemporaryDirectory() as temporary_directory,
            patch(
                "services.sync.src.settlement_processing.acquisition.download_aged_storage_report",
                return_value=downloaded_aged,
            ),
            patch(
                "services.sync.src.settlement_processing.acquisition.download_removal_report",
                return_value=downloaded_removal,
            ),
            patch(
                "services.sync.src.settlement_processing.acquisition.decompress_report_document",
                side_effect=(aged_bytes, removal_bytes),
            ) as decompress,
            patch(
                "services.sync.src.settlement_processing.acquisition.parse_aged_storage_fee_document"
            ) as parse_aged,
            patch(
                "services.sync.src.settlement_processing.acquisition.parse_removal_fee_document"
            ) as parse_removal,
            patch(
                "services.sync.src.settlement_processing.acquisition."
                "build_aged_storage_fee_batch_from_parsed",
                return_value=aged_batch,
            ),
            patch(
                "services.sync.src.settlement_processing.acquisition."
                "build_removal_fee_batch_from_parsed",
                return_value=removal_batch,
            ),
        ):
            artifact_root = Path(temporary_directory)
            artifacts = ProcessingArtifactLog.create(artifact_root, "processing-1")
            observations = acquire_auxiliary_observations(
                settlement,
                AuxiliaryRequirements(fba_aged_storage=True, fba_removal=True),
                AuxiliaryClients(reports=cast(FbaReportsClient, object())),
                artifacts,
                AuxiliaryAcquisitionSettings(poll_interval_seconds=0),
                now=datetime(2026, 9, 4, tzinfo=UTC),
            )

            self.assertEqual(observations, ())
            self.assertEqual(
                decompress.call_args_list,
                [call(aged_document), call(removal_document)],
            )
            parse_aged.assert_called_once_with(aged_bytes, amazon_scope="NA")
            parse_removal.assert_called_once_with(removal_bytes, amazon_scope="NA")
            self.assertEqual(
                (
                    artifacts.directory / "fba-long-term" / marketplace_id / "report-1.tsv"
                ).read_bytes(),
                aged_bytes,
            )
            self.assertEqual(
                (artifacts.directory / "fba-removal" / marketplace_id / "report.tsv").read_bytes(),
                removal_bytes,
            )


if __name__ == "__main__":
    unittest.main()
