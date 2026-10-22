import os
from pydantic_settings import BaseSettings

_APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Settings(BaseSettings):
    # Secrets come from environment variables / .env only — never hardcode them.
    openrouter_api_key: str = ""
    huggingface_api_key: str = ""
    tavily_api_key: str = ""

    llm_model: str = "meta-llama/llama-3.2-1b-instruct"
    llm_base_url: str = "https://openrouter.ai/api/v1"
    llm_temperature: float = 0.0
    embed_model: str = "all-MiniLM-L6-v2"

    chunk_size: int = 900
    chunk_overlap: int = 150
    k_retrieval: int = 4
    upper_th: float = 0.7
    lower_th: float = 0.3

    # Bundled documents live in crag-app/documents; fall back to the
    # notebook repo's ../documents for local development.
    documents_dir: str = (
        os.path.join(_APP_ROOT, "documents")
        if os.path.isdir(os.path.join(_APP_ROOT, "documents"))
        else os.path.abspath(os.path.join(_APP_ROOT, "..", "documents"))
    )
    index_dir: str = os.path.join(_APP_ROOT, "faiss_index")

    class Config:
        env_file = os.path.join(_APP_ROOT, ".env")
        env_file_encoding = "utf-8"
        extra = "allow"


settings = Settings()
