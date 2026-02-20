FROM oven/bun:1-alpine

WORKDIR /app

COPY web/server.ts .
COPY web/public ./public

ENV BRAIN_PATH=/data/brain.json
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
