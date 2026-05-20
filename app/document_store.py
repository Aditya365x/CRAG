import os
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from app.config import settings
from app.embeddings import get_embeddings

_vector_store = None
_chunks = []


def load_and_chunk_documents():
    global _chunks
    if _chunks:
        return _chunks

    docs_dir = settings.documents_dir
    if not os.path.exists(docs_dir):
        os.makedirs(docs_dir, exist_ok=True)
        print(f"Created documents directory: {docs_dir}")
        return []

    pdf_files = sorted(
        f for f in os.listdir(docs_dir) if f.lower().endswith(".pdf")
    )
    if not pdf_files:
        print(f"No PDFs found in {docs_dir}")
        return []

    all_docs = []
    for pdf in pdf_files:
        path = os.path.join(docs_dir, pdf)
        print(f"Loading: {pdf}")
        loader = PyPDFLoader(path)
        all_docs.extend(loader.load())

    if not all_docs:
        return []

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
    )
    chunks = splitter.split_documents(all_docs)

    for d in chunks:
        d.page_content = (
            d.page_content.encode("utf-8", "ignore").decode("utf-8", "ignore")
        )

    print(f"Created {len(chunks)} chunks from {len(pdf_files)} PDF(s)")
    _chunks = chunks
    return chunks


def get_vector_store():
    global _vector_store
    if _vector_store is not None:
        return _vector_store

    chunks = load_and_chunk_documents()
    if not chunks:
        return None

    embeddings = get_embeddings()
    _vector_store = FAISS.from_documents(chunks, embeddings)
    return _vector_store


def get_retriever():
    vs = get_vector_store()
    if vs is None:
        return None
    return vs.as_retriever(
        search_type="similarity", search_kwargs={"k": settings.k_retrieval}
    )
