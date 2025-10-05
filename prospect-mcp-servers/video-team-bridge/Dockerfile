# Use Python slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Set Python unbuffered mode
ENV PYTHONUNBUFFERED=1

# Install system dependencies for web automation including Playwright
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    gnupg \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright system dependencies as root
RUN playwright install-deps chromium

# Create non-root user
RUN useradd -m -u 1000 mcpuser

# Copy the server code
COPY npid_server.py .
COPY npid_automator.py .
COPY npid_bridge.py .

# Change ownership of app directory to mcpuser
RUN chown -R mcpuser:mcpuser /app

# Switch to non-root user BEFORE installing browsers
USER mcpuser

# Install Playwright browsers as mcpuser (in user cache)
RUN playwright install chromium

# Expose the HTTP bridge port
EXPOSE 8812

# Run the HTTP bridge server
CMD ["python", "npid_bridge.py"]
