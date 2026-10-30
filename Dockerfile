FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY index.js runner.js config.json invites.js control-api.js world-health.js protocol-compat.js verify-protocol.cjs THIRD-PARTY-NOTICES.txt ./
RUN node verify-protocol.cjs --server
ENV DATA_DIR=/data
CMD ["npm", "start"]
