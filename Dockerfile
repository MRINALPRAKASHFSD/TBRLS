# Use Node.js 24 LTS alpine for lightweight, modern runtime
FROM node:24-alpine AS builder

WORKDIR /app

# Copy dependency specifications
COPY package*.json tsconfig.json ./

# Install all dependencies including devDependencies for build
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript to dist
RUN npm run build

# Production image
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled artifacts from builder stage
COPY --from=builder /app/dist ./dist
# Copy SQL migrations for runtime migration runner
COPY src/db/migrations ./dist/db/migrations

# Non-root user for security best practices
USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]
