"""Prebuild the demo PDF's index at Docker build time: python -m app.seed_demo"""
from pathlib import Path

from . import config
from .ingest import build_index

if __name__ == "__main__":
    path = Path(config.DEMO_PDF)
    if not path.exists():
        print(f"No demo PDF at {path}; skipping.")
    else:
        meta = build_index(config.DEMO_DOC_ID, str(path), path.name, max_pages=10_000,
                           progress=lambda f, msg: print(f"{f:5.0%}  {msg}", flush=True))
        print(meta.get("status"), meta.get("pages"), "pages,", meta.get("chunks"), "chunks,",
              meta.get("index_seconds"), "s", meta.get("error", ""))
