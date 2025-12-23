# Use official Node.js 18 base image
FROM node:18

# Set working directory
WORKDIR /app

# Install required build tools for bcrypt
RUN apt-get update && apt-get install -y python3 make g++ && apt-get clean

# Copy only package files first for caching
COPY package*.json ./

# Install dependencies
RUN npm install --build-from-source

# Install nodemon globally for development
RUN npm install -g nodemon

# Copy rest of the app files
COPY . .

# Expose port 5000
EXPOSE 5000

# Run seed and then start the app
CMD ["sh", "-c", "npm run seed && npm start"]
