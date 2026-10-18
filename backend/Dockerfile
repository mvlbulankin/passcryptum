# Multi-stage build: Vue single-file frontend embedded into the Go binary
# (ADR-0001). Build context must be the REPO ROOT:
#   docker build -f backend/Dockerfile -t passcryptum .
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM golang:1.26-alpine AS backend
WORKDIR /src
COPY backend/ ./
RUN go mod download
# embed the built SPA
COPY --from=frontend /app/dist ./web
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/passcryptum .

# The data directory is created here so the named volume inherits its
# ownership: a volume mounted over a root-owned path would leave the
# non-root process unable to write its SQLite file.
RUN mkdir -p /out/data && chown 65532:65532 /out/data

FROM scratch

# Nothing runs as root: the binary owns no privileged resource and the
# listening port is unprivileged (Caddy terminates :443 in front).
USER 65532:65532

COPY --from=backend --chown=65532:65532 /out/passcryptum /passcryptum
COPY --from=backend /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=backend --chown=65532:65532 /out/data /data

VOLUME /data
# Writable scratch for SQLite temporaries; the rest of the filesystem is
# read-only in compose.
ENV PC_DB=/data/passcryptum.db \
    TMPDIR=/tmp
EXPOSE 8000
ENTRYPOINT ["/passcryptum"]
CMD ["serve", ":8000"]
