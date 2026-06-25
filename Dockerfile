# Stage 1: Build the frontend static files
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors first to cache dependencies build step
COPY package*.json ./
RUN npm ci

# Copy all source files
COPY . .

# Run production build
RUN npm run build

# Stage 2: Production server runner
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package descriptors and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server implementation
COPY server/ ./server/

# Copy initial pre-seeded datasets
COPY data/ ./data/

# Copy compiled frontend from builder stage
COPY --from=builder /app/dist ./dist

# Expose backend port
EXPOSE 5001

# Run server
CMD ["node", "server/server.js"]
