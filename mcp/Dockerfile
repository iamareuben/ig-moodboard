FROM node:20-slim

# better-sqlite3 is a native module — needs build tools when no prebuilt binary matches the target arch
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/

EXPOSE 3002

CMD ["node", "src/index.js"]
