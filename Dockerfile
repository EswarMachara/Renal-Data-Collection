FROM node:20-alpine
WORKDIR /app

# Install dependencies first (separate layer for cache efficiency)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY server.js ./
COPY public/ ./public/

# data/ is mounted as a volume at runtime — do not copy it into the image
RUN mkdir -p data/submissions data/upload-sessions data/private

EXPOSE 8000
CMD ["node", "server.js"]
