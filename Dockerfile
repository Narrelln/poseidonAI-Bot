# --- runtime image ---
FROM node:20-alpine

# Create app dir
WORKDIR /app

# Install deps first (better cache)
COPY package*.json ./
RUN npm ci --only=production || npm install --only=production

# Copy source
COPY . .

# Environment + port
ENV NODE_ENV=production
EXPOSE 3000

# Start your app
CMD ["node","index.js"]
