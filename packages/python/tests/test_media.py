from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from discomposer import MediaError, MediaStore

PNG = b"\x89PNG\r\n\x1a\n"


def test_threaded_quota_and_recovery(tmp_path):
    first, second = PNG + b"first", PNG + b"other"
    store = MediaStore(tmp_path, quota=len(first))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [pool.submit(store.save, raw) for raw in (first, second)]
        saved = []
        failures = []
        for future, raw in zip(results, (first, second), strict=True):
            try:
                saved.append((future.result(), raw))
            except MediaError as error:
                failures.append(str(error))
    assert len(saved) == len(failures) == 1
    assert "full" in failures[0]
    name, raw = saved[0]
    assert store.save(raw) == name
    assert store.read(name) == raw
    assert list(tmp_path.iterdir()) == [tmp_path / name]


def test_failed_atomic_publish_cleans_up_and_can_be_retried(tmp_path, monkeypatch):
    store = MediaStore(tmp_path)
    replace = Path.replace

    def failed(*args, **kwargs):
        raise OSError("simulated publish failure")

    monkeypatch.setattr(Path, "replace", failed)
    with pytest.raises(OSError, match="publish failure"):
        store.save(PNG + b"first")
    assert list(tmp_path.iterdir()) == []
    monkeypatch.setattr(Path, "replace", replace)
    name = store.save(PNG + b"first")
    assert store.read(name) == PNG + b"first"
