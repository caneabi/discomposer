import hashlib
import re
from pathlib import Path

import discord

MAX_IMAGE = 8 * 1024 * 1024
ATTACHMENT_NAME = re.compile(r"pb-[0-9a-f]{16}\.(?:png|jpg|gif|webp)")
STORED_NAME = re.compile(r"[0-9a-f]{64}")


class MediaError(ValueError):
    """An image can't be stored. The message is meant for end users."""


def image_extension(raw):
    """Detect the format from the bytes. Anything else, including SVG, is rejected."""
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if raw.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return None


class MediaStore:
    """Stores images by SHA-256 in a folder with a size limit."""

    def __init__(self, path, quota=128 * 1024 * 1024):
        self.path = Path(path)
        self.quota = quota

    def save(self, raw):
        if len(raw) > MAX_IMAGE or not image_extension(raw):
            raise MediaError("Please use a PNG, JPEG, GIF or WebP image up to 8 MB.")
        self.path.mkdir(parents=True, exist_ok=True)
        name = hashlib.sha256(raw).hexdigest()
        target = self.path / name
        if not target.exists():
            used = sum(p.stat().st_size for p in self.path.iterdir() if p.is_file())
            if used + len(raw) > self.quota:
                raise MediaError("The image store is full. Please clean up old template images.")
            target.write_bytes(raw)
        return name

    def file(self, stored):
        if not isinstance(stored, str) or not STORED_NAME.fullmatch(stored):
            raise MediaError("Invalid stored image name.")
        return self.path / stored

    def read(self, stored):
        return self.file(stored).read_bytes()

    def attachment_name(self, stored, raw):
        return f"pb-{stored[:16]}.{image_extension(raw)}"

    def files_for(self, design):
        """discord.File objects for all adopted images of a design."""
        files = []
        for filename, stored in design.get("attachments", {}).items():
            if not ATTACHMENT_NAME.fullmatch(filename):
                raise MediaError("Invalid stored image name.")
            files.append(discord.File(self.file(stored), filename=filename))
        return files
