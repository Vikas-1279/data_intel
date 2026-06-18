# Use node image
FROM node:20-slim

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build frontend
# Note: GEMINI_API_KEY is required during build for the frontend
ARG GEMINI_API_KEY
ENV GEMINI_API_KEY=$GEMINI_API_KEY
RUN npm run build

# Expose port
EXPOSE 3000

# Start server
ENV NODE_ENV=production
CMD ["npm", "start"]
