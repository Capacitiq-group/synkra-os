# ---- Stage 1: build the frontend --------------------------------------
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: PocketBase runtime ---------------------------------------
# PocketBase ships as a single Go binary. We download the release archive
# for the target platform at build time (this requires network access on
# whatever machine/CI runs `docker build` — it is NOT available in the
# sandbox this repo was authored in, so this image has not been built here;
# see README.md "Build & verify" for the exact commands to run yourself).
FROM alpine:3.20 AS pocketbase-download
ARG POCKETBASE_VERSION=0.25.9
RUN apk add --no-cache curl unzip ca-certificates \
  && curl -L -o /tmp/pb.zip \
     "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_amd64.zip" \
  && unzip /tmp/pb.zip -d /tmp/pb \
  && mv /tmp/pb/pocketbase /usr/local/bin/pocketbase \
  && chmod +x /usr/local/bin/pocketbase

# ---- Stage 3: final image ----------------------------------------------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata curl
WORKDIR /pb

COPY --from=pocketbase-download /usr/local/bin/pocketbase /usr/local/bin/pocketbase
COPY pocketbase/pb_migrations ./pb_migrations
COPY pocketbase/pb_hooks ./pb_hooks
# PocketBase serves this directory as the site root when present, so the
# React build IS the frontend deployment — no separate nginx container.
COPY --from=frontend-build /app/frontend/dist ./pb_public

# Persistent application data (SQLite + uploaded files) lives here.
# Mount a volume at this path in docker-compose / Coolify so data survives
# redeploys.
VOLUME ["/pb/pb_data"]

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8090/health || exit 1

ENTRYPOINT ["pocketbase"]
CMD ["serve", "--http=0.0.0.0:8090"]
