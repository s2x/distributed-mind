FROM oven/bun:1-alpine

WORKDIR /app

# Copy the whole project (server.ts imports from ../cli/src/)
COPY package.json bun.lock ./
COPY cli/ ./cli/
COPY web/ ./web/

RUN bun install --frozen-lockfile

WORKDIR /app/web

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
