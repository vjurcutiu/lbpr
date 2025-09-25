# ---------- base layer: shared runtime ----------
FROM python:3.11-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# (optional) system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

# install only runtime deps
COPY requirements.txt .
RUN pip install -r requirements.txt

# copy app code
COPY . .

# ---------- test/dev layer: adds test deps ----------
FROM base AS test
# requirements-dev.txt must include:  -r requirements.txt
COPY requirements-dev.txt .
RUN pip install -r requirements-dev.txt

# default command for the test image
CMD ["pytest", "-q", "--maxfail=1", "--disable-warnings", "--cov=app", "--cov-report=term-missing"]

# ---------- production runtime ----------
FROM base AS runtime
EXPOSE 8000
# If your ASGI app is "main:app" in project root, keep this.
# If it's "app.main:app", change accordingly.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
