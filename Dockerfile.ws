# Image for the standalone WebSocket gateway (ws-server/), deployed as the
# separate `collabpro-ws` Railway service (set its Dockerfile path to
# Dockerfile.ws). The main Dockerfile only ships Next's standalone output, so
# it contains neither ws-server/ nor tsx and cannot run the gateway.
FROM node:22-alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

# Production dependencies only (tsx, prisma, ws, ioredis, amqplib ...). The
# postinstall script runs `prisma generate`, so the schema and prisma config
# must be present before `npm ci`.
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma/
RUN npm ci --omit=dev

# What the gateway imports: ws-server/ and the shared lib/ modules (some use
# the "@/..." alias, so tsx needs tsconfig.json to resolve it).
COPY tsconfig.json ./
COPY ws-server ./ws-server
COPY lib ./lib

USER node
EXPOSE 3001
# Railway injects PORT; ws-server reads PORT, then WS_PORT, then 3001.
CMD ["node_modules/.bin/tsx", "ws-server/server.ts"]
