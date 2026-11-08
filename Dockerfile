FROM node:18-alpine

# Install Python and required packages for Ollama
RUN apk add --no-cache python3 && \
    python3 -m ensurepip && \
    pip3 install --no-cache-dir onnxruntime pathvalidate

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy app source
COPY . .

# Expose port
EXPOSE 3000

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

# Start Ollama in background, then start Node server
CMD ["sh", "-c", "ollama serve &"] && \
    ["node", "server.js"]