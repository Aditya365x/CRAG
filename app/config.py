import os
from pydantic_settings import BaseSettings

dirname = r''

class Settings(BaseSettings):
    kimi_api_key: str = ""
    huggingface_api_key: str = ""
    tavily_api_key: str = "A"

    llm_model: str = "kimi-k2.6"
    llm_base_url: str = "https://api.moonshot.ai/v1"
    embed_model: str = "all-MiniLM-L6-v2"

    chunk_size: int = 900
    chunk_overlap: int = 150
    k_retrieval: int = 4
    upper_th: float = 0.7
    lower_th: float = 0.3
    documents_dir: str = os.path.abspath(
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "..",
            "documents",
        )
    )

    class Config:
        env_file = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"
        )
        env_file_encoding = "utf-8"
        extra = "allow"


settings = Settings()
