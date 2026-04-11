FROM oven/bun:1-alpine

WORKDIR /app

# Copy the whole project (server.ts imports from ../src/)
COPY package.json bun.lock ./
COPY src/ ./src/
COPY web/ ./web/

RUN bun install --frozen-lockfile

WORKDIR /app/web

EXPOSE 3000

CMD ["bun", "run", "src/api/server.ts"]
