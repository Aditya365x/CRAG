import os
from pydantic_settings import BaseSettings

dirname = r'D:\Project_for_placements\agenticRag\corrective-rag\documents'

class Settings(BaseSettings):
    kimi_api_key: str = "sk-pCbOeAAWhDAGcaUOUrrOrDHrZoTDpR8fe8H333o514wjo6DT"
    huggingface_api_key: str = "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"
    tavily_api_key: str = "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"

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
