FROM node:20-slim

# Install ffmpeg, curl (for yt-dlp), python3 (yt-dlp runtime dep), and build tools for native addons
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/* \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/

RUN mkdir -p /app/data/videos

EXPOSE 3001

CMD ["node", "src/index.js"]
