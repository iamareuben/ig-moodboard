FROM node:20-slim

# Install ffmpeg, curl (for yt-dlp), python3 (yt-dlp runtime dep), and build tools for native addons
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    make \
    g++ \
    && pip3 install yt-dlp curl_cffi faster-whisper --break-system-packages \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/

RUN mkdir -p /app/data/videos /app/data/models

EXPOSE 3001

CMD ["node", "src/index.js"]
