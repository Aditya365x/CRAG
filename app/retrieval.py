"""Hybrid retrieval for one uploaded PDF: BM25 (exact words) + MiniLM vectors (meaning), fused with RRF."""
import json
import re
from functools import lru_cache

import faiss
import numpy as np
from langchain_core.documents import Document
from rank_bm25 import BM25Okapi

from . import config, storage
from .ingest import doc_dir, embed

_STOP = set("a an the of to in on for and or is are was were be by with as at from this that it its how what why "
            "which who does do did can could should would i you we they".split())


def tokenize(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOP]


class DocIndex:
    def __init__(self, doc_id: str):
        d = doc_dir(doc_id)
        storage.pull(doc_id, "chunks.json", "index.faiss")
        self.doc_id = doc_id
        self.chunks = json.loads((d / "chunks.json").read_text())
        self.index = faiss.read_index(str(d / "index.faiss"))
        self.bm25 = BM25Okapi([tokenize(c["text"]) for c in self.chunks])

    def search(self, query: str, k: int = config.TOP_K) -> list[Document]:
        n = len(self.chunks)
        cand = min(config.CANDIDATES, n)
        _, vec_ids = self.index.search(embed([query]), cand)
        bm = self.bm25.get_scores(tokenize(query))
        bm_ids = [i for i in np.argsort(-bm)[:cand] if bm[i] > 0]

        fused: dict[int, float] = {}
        for ranking in (list(vec_ids[0]), bm_ids):
            for rank, i in enumerate(ranking):
                fused[int(i)] = fused.get(int(i), 0.0) + 1.0 / (config.RRF_K + rank + 1)

        top = sorted(fused, key=fused.get, reverse=True)[:k]
        return [Document(page_content=self.chunks[i]["text"],
                         metadata={"source": "book", "page": self.chunks[i]["page"], "chunk_id": i})
                for i in top]


@lru_cache(maxsize=8)
def get_index(doc_id: str) -> DocIndex:
    return DocIndex(doc_id)
