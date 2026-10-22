FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FASTEMBED_CACHE=/app/models \
    DATA_DIR=/app/data \
    PORT=7860

# Render / Hugging Face Spaces run containers as a non-root user (uid 1000).
# Files are owned by that user as they're created; a later `chown -R` would duplicate every layer.
RUN useradd -m -u 1000 user && mkdir /app && chown user /app
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

USER user

# Download MiniLM (ONNX, ~90 MB) at build time so the app never downloads it at runtime.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('sentence-transformers/all-MiniLM-L6-v2', cache_dir='/app/models')"

COPY --chown=user documents ./documents
COPY --chown=user app ./app

# Prebuild the demo book's index so the app works with zero uploads.
RUN python -m app.seed_demo

EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.api:app --host 0.0.0.0 --port ${PORT}"]
