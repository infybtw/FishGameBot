FROM oven/bun:1.4.0 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.4.0
WORKDIR /app
ENV NODE_ENV=production
USER root
RUN apt-get update && apt-get install --no-install-recommends -y librsvg2-bin && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
USER bun
CMD ["bun", "src/index.ts"]
