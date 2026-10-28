# syntax=docker/dockerfile:1
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Amazon RDS CA bundle for verified TLS (DB_SSL_CA_FILE). Pinned by digest;
# when AWS rotates the bundle, update the checksum after reviewing the new file.
# Create the directory first: ADD --chmod would also apply 644 to a directory
# it creates, leaving it untraversable for the non-root user.
RUN mkdir -p /app/certs
ADD --chmod=644 --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem

COPY . .

USER node

EXPOSE 8080

CMD ["node", "index.js"]
