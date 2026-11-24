# Journal server image: the Node server (backend/, core/) and the site (site/). No npm dependencies: only Node's own modules are used.
FROM node:24-slim

LABEL org.opencontainers.image.source="https://github.com/janybek/college-journal"
LABEL org.opencontainers.image.description="College journal: the server (Node.js, SQLite) and the site on one address"

WORKDIR /app
COPY package.json ./
COPY backend ./backend
COPY core ./core
COPY site ./site

# The version shown by /health: the short commit hash, given by the image build (.git is not in the image).
ARG JOURNAL_VERSION=unknown

# JOURNAL_ORIGINS is not set here: the cluster gives the address of its site (see DOCKER.md).
ENV NODE_ENV=production \
    JOURNAL_DATA_DIR=/data \
    JOURNAL_BACKUP_DIR=/backup \
    JOURNAL_HOST=0.0.0.0 \
    JOURNAL_PORT=5373 \
    JOURNAL_SITE_DIR=/app/site \
    JOURNAL_AUTO_INIT=1 \
    JOURNAL_VERSION=$JOURNAL_VERSION

# The application files stay owned by root (read-only for the user node); only the two data folders are writable.
RUN mkdir -p /data /backup && chown node:node /data /backup
USER node

EXPOSE 5373
VOLUME ["/data", "/backup"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.JOURNAL_PORT||5373)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "backend/node/server.js"]
