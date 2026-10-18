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

FROM scratch
COPY --from=backend /out/passcryptum /passcryptum
COPY --from=backend /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
VOLUME /data
ENV PC_DB=/data/passcryptum.db
EXPOSE 8000
ENTRYPOINT ["/passcryptum"]
CMD ["serve", ":8000"]
