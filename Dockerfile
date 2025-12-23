# Use official Node.js LTS
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files first (for caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy full source code
COPY . .

# Expose backend port
EXPOSE 5000

# 🔥 IMPORTANT:
# 1️⃣ Run seed (create admin/manager if missing)
# 2️⃣ Start backend server
CMD ["sh", "-c", "npm run seed && npm start"]
