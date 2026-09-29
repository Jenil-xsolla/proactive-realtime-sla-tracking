# Production image for both Cloud Run services (docs/deploy.md): one image,
# deployed twice, selected at startup by SERVICE_ROLE. Do not build
# per-service images.

FROM node:22-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# ---- deps: install dependencies with a frozen lockfile -------------------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- builder: build the Next.js app ---------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next.config.ts sets output: "standalone", so `pnpm build` produces a
# trimmed, self-contained server under .next/standalone.
RUN pnpm build

# ---- runner: minimal runtime image from Next's standalone output ---------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# No public/ directory exists in this repo today; add a
# `COPY --from=builder --chown=nextjs:nodejs /app/public ./public` line here
# if one is added later.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 8080

CMD ["node", "server.js"]
