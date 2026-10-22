"""Prebuild the FAISS index so deployments start fast: python -m app.build_index"""
from app.document_store import get_vector_store

if __name__ == "__main__":
    vs = get_vector_store()
    print("No documents found." if vs is None else f"Indexed {vs.index.ntotal} chunks.")
