"""Optional shared storage for uploaded documents (Vercel Blob).

Serverless hosts run several stateless instances, so an upload indexed on one instance is invisible to
the next request if it lands elsewhere. When a Blob store is connected (BLOB_READ_WRITE_TOKEN or
BLOB_STORE_ID is set), each document's index files are mirrored to `docs/<doc_id>/` in a private store
and pulled into the local data dir on demand. Without a store, everything stays on local disk.
"""
import os
from pathlib import Path

from . import config

ENABLED = bool(os.getenv("BLOB_READ_WRITE_TOKEN") or os.getenv("BLOB_STORE_ID"))
PREFIX = "docs/"


def _key(doc_id: str, name: str) -> str:
    return f"{PREFIX}{doc_id}/{name}"


def push(doc_id: str, *names: str) -> None:
    """Upload these files from the document's local folder."""
    if not ENABLED:
        return
    from vercel.blob.sync import put_blob

    d = config.DATA_DIR / doc_id
    for name in names:
        p = d / name
        if p.exists():
            put_blob(_key(doc_id, name), p.read_bytes(), access="private", allow_overwrite=True)


def pull(doc_id: str, *names: str, refresh: bool = False) -> bool:
    """Download missing (or, with refresh, all) files into the local folder. True if all are present."""
    d = config.DATA_DIR / doc_id
    if not ENABLED:
        return all((d / n).exists() for n in names)
    from vercel.blob.sync import BlobNotFoundError, get_blob

    for name in names:
        p = d / name
        if p.exists() and not refresh:
            continue
        try:
            body = get_blob(_key(doc_id, name), access="private").body
        except BlobNotFoundError:
            return False
        d.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        tmp.write_bytes(body)
        tmp.replace(p)
    return True


def remote_doc_ids() -> list[str]:
    """Documents that have metadata in the store."""
    if not ENABLED:
        return []
    from vercel.blob.sync import query_blobs

    ids = set()
    for b in query_blobs(prefix=PREFIX):
        parts = Path(b.pathname).parts
        if len(parts) == 3 and parts[2] == "meta.json":
            ids.add(parts[1])
    return sorted(ids)
