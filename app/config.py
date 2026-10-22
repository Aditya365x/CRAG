"""All settings in one place. Everything can be overridden with environment variables."""
import os
from pathlib import Path

from dotenv import load_dotenv

APP_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(APP_ROOT / ".env")

# ---------- storage ----------
DATA_DIR = Path(os.getenv("DATA_DIR", str(APP_ROOT / "data")))       # one folder per uploaded PDF
MODEL_CACHE = os.getenv("FASTEMBED_CACHE", str(APP_ROOT / "models"))  # where MiniLM (ONNX) is stored
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ---------- embeddings + chunking ----------
EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"    # same model as the notebook, run with ONNX
EMBED_DIM = 384
CHUNK_SIZE = 900
CHUNK_OVERLAP = 150
MAX_PAGES = int(os.getenv("MAX_PAGES", "400"))            # keeps indexing fast on a free CPU
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "40"))
# ONNX memory grows with batch size: 64 peaks ~1.2 GB, 8 stays ~330 MB (fits 512 MB hosts).
EMBED_BATCH = int(os.getenv("EMBED_BATCH", "8"))

# ---------- retrieval ----------
TOP_K = 4              # chunks sent to the grader
CANDIDATES = 20        # candidates from each retriever before fusion
RRF_K = 60             # reciprocal rank fusion constant

# ---------- CRAG ----------
UPPER_TH = 0.7
LOWER_TH = 0.3
FILTER_GROUP = 25      # sentences per batch-filter call (avoids "lost in the middle")
WEB_RESULTS = 5

# ---------- LLM (any OpenAI-compatible provider) ----------
# OpenRouter:       LLM_BASE_URL=https://openrouter.ai/api/v1      LLM_MODEL=meta-llama/llama-3.3-70b-instruct
# Groq free tier:   LLM_BASE_URL=https://api.groq.com/openai/v1   LLM_MODEL=llama-3.3-70b-versatile
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "meta-llama/llama-3.3-70b-instruct")
LLM_API_KEY = os.getenv("LLM_API_KEY") or os.getenv("OPENROUTER_API_KEY") or os.getenv("openrouter_api_key", "")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
MAX_CONCURRENCY = int(os.getenv("MAX_CONCURRENCY", "4"))

# ---------- demo document ----------
# Prebuilt into the image at build time (python -m app.seed_demo) so the app works with zero uploads.
DEMO_PDF = os.getenv("DEMO_PDF", str(APP_ROOT / "documents" / "book1.pdf"))
DEMO_DOC_ID = "demo0001"
DEMO_QUESTIONS = [
    "What is the bias-variance trade-off?",
    "How does the EM algorithm work for Gaussian mixtures?",
    "What is a support vector machine?",
    "What is retrieval-augmented generation?",
]
