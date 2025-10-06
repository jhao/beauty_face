#!/usr/bin/env python3
"""Download Human AI model files into the local public/models directory."""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Default CDN location for the Human model package. Newer Human releases
# distribute model assets via the dedicated `@vladmandic/human-models`
# package instead of bundling them with the core library.
BASE_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/human-models/models/"
MANIFEST_NAME = "models.json"
USER_AGENT = "beauty-face-model-downloader/1.0"


@dataclass
class DownloadTask:
    url: str
    destination: Path


def build_request(url: str) -> Request:
    return Request(url, headers={"User-Agent": USER_AGENT})


def download_binary(task: DownloadTask, force: bool = False) -> int:
    if task.destination.exists() and not force:
        return 0

    task.destination.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(build_request(task.url)) as response:  # nosec: B310 - controlled URL
        data = response.read()

    with open(task.destination, "wb") as file:
        file.write(data)
    return len(data)


def load_remote_json(url: str) -> dict:
    with urlopen(build_request(url)) as response:  # nosec: B310 - controlled URL
        return json.load(response)


def _collect_model_entries(data: object) -> List[dict]:
    """Return a flat list of manifest entries that reference downloadable files."""

    entries: List[dict] = []

    def visit(node: object) -> None:
        if isinstance(node, dict):
            if any(isinstance(node.get(key), str) for key in ("file", "name", "url")):
                entries.append(node)
                return
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for item in node:
                visit(item)

    visit(data)
    return entries


def iter_model_files(manifest: dict, base_url: str, dest_dir: Path) -> Iterable[DownloadTask]:
    models: List[dict] = []

    # Newer Human releases expose model descriptors under different structures,
    # so we try a few sensible locations before falling back to scanning the
    # entire manifest.
    for candidate in (manifest.get("models"), manifest.get("files")):
        models.extend(_collect_model_entries(candidate))

    if not models:
        models = _collect_model_entries(manifest)

    seen: set[Path] = set()

    for entry in models:
        filename = entry.get("file") or entry.get("name") or entry.get("url")
        if not filename:
            continue

        filename = filename.rsplit("/", 1)[-1]
        json_url = base_url + filename
        json_dest = dest_dir / filename
        if json_dest in seen:
            continue
        seen.add(json_dest)
        yield DownloadTask(json_url, json_dest)

        try:
            model_def = load_remote_json(json_url)
        except (HTTPError, URLError):
            continue

        for weight_group in model_def.get("weightsManifest", []):
            for weight_file in weight_group.get("paths", []):
                weight_url = base_url + weight_file
                weight_dest = dest_dir / weight_file
                if weight_dest in seen:
                    continue
                seen.add(weight_dest)
                yield DownloadTask(weight_url, weight_dest)


def main() -> None:
    parser = argparse.ArgumentParser(description="Download Human AI model assets.")
    parser.add_argument(
        "--dest",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "public" / "models",
        help="Destination directory for downloaded models.",
    )
    parser.add_argument("--force", action="store_true", help="Redownload files even if they already exist.")
    parser.add_argument("--base-url", default=BASE_URL, help="Custom base URL for Human model files.")
    args = parser.parse_args()

    dest_dir: Path = args.dest
    base_url: str = args.base_url.rstrip("/") + "/"

    manifest_url = base_url + MANIFEST_NAME
    print(f"Fetching manifest from {manifest_url}…")

    try:
        manifest = load_remote_json(manifest_url)
    except HTTPError as error:
        raise SystemExit(f"Failed to download manifest: HTTP {error.code} {error.reason}") from error
    except URLError as error:
        raise SystemExit(f"Failed to download manifest: {error.reason}") from error

    tasks = list(iter_model_files(manifest, base_url, dest_dir))
    if not tasks:
        raise SystemExit("Manifest did not contain any downloadable models.")

    total_bytes = 0
    for task in tasks:
        try:
            size = download_binary(task, force=args.force)
        except HTTPError as error:
            print(f"✖ Failed to download {task.url}: HTTP {error.code} {error.reason}")
            continue
        except URLError as error:
            print(f"✖ Failed to download {task.url}: {error.reason}")
            continue

        if size:
            total_bytes += size
            print(f"✔ Downloaded {task.destination.relative_to(dest_dir)} ({size} bytes)")
        else:
            print(f"• Skipped {task.destination.relative_to(dest_dir)} (already exists)")

    print(f"Done. Saved files into {dest_dir} (downloaded {total_bytes} bytes).")


if __name__ == "__main__":
    main()
