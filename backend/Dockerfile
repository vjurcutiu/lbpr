# ---------- base layer: shared runtime ----------
FROM python:3.11-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System deps + Doppler CLI (Debian/Ubuntu pattern from official docs)
RUN apt-get update && apt-get install -y --no-install-recommends \      apt-transport-https ca-certificates curl gnupg \    && curl -sLf --retry 3 --tlsv1.2 --proto "=https" 'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' \       | gpg --dearmor -o /usr/share/keyrings/doppler-archive-keyring.gpg \    && echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" \       | tee /etc/apt/sources.list.d/doppler-cli.list \    && apt-get update \    && apt-get -y install doppler \    && rm -rf /var/lib/apt/lists/*

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

# Ensure imports like "from core..." resolve
ENV PYTHONPATH=/app
# Avoid initializing Firebase Admin in test runs (optional; you can also set this in compose)
ENV SKIP_FIREBASE_INIT=1

# Collect coverage for the whole repo (not a non-existent "app" package)
CMD ["pytest", "-q", "--maxfail=1", "--disable-warnings", "--cov=.", "--cov-report=term-missing"]

# ---------- production runtime ----------
FROM base AS runtime
EXPOSE 8000
# If your ASGI app is "main:app" in project root, keep this.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
