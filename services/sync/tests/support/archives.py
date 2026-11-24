"""In-memory archive for workflow tests."""

from services.sync.src.archives.storage import ArchiveIntegrityError


class MemoryArchiveStorage:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put(self, bucket: str, object_path: str, content: bytes) -> None:
        key = (bucket, object_path)
        if key in self.objects and self.objects[key] != content:
            raise ArchiveIntegrityError("Object replacement is forbidden.")
        self.objects[key] = content

    def get(self, bucket: str, object_path: str) -> bytes:
        return self.objects[bucket, object_path]
