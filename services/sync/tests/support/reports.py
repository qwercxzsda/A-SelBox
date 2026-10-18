"""Generic Reports document transport fixtures shared with Inventory."""


def make_report_text() -> str:
    return "sku\tquantity\r\nSKU-1\t10\r\n"


class FakeResponse:
    def __init__(self, payload: dict[str, object], next_token: str | None) -> None:
        self.payload = payload
        self.next_token = next_token


class FakeClient:
    def __init__(self, report_text: str) -> None:
        self.report_text = report_text
        self.downloads: list[str] = []

    def get_report_document(self, report_document_id: str) -> FakeResponse:
        self.downloads.append(report_document_id)
        return FakeResponse(
            {
                "reportDocumentId": report_document_id,
                "url": f"https://download.invalid/{report_document_id}",
            },
            None,
        )

    def download_document_bytes(self, document_url: str) -> bytes:
        if not document_url.startswith("https://download.invalid/"):
            raise ValueError("Unexpected test document URL.")
        return self.report_text.encode()
