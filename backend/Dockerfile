FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (including Playwright Chromium deps)
RUN apt-get update && apt-get install -y \
    gcc \
    ffmpeg \
    libxml2-dev \
    libxslt-dev \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Start command - Railway will provide PORT env var
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
