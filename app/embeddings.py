from langchain_community.embeddings import HuggingFaceEmbeddings
from app.config import settings

_embeddings = None


def get_embeddings():
    global _embeddings
    if _embeddings is None:
        kwargs = {}
        if settings.huggingface_api_key:
            kwargs["model_kwargs"] = {"token": settings.huggingface_api_key}
        _embeddings = HuggingFaceEmbeddings(
            model_name=settings.embed_model,
            **kwargs,
        )
    return _embeddings
