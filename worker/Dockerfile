FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/pyproject.toml .
RUN pip install --no-cache-dir .
COPY backend .
RUN mkdir -p /app/storage
CMD ["celery", "-A", "app.celery_app:celery_app", "worker", "--loglevel=INFO", "--concurrency=1"]

