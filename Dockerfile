FROM node:18-alpine

# Install Python and required packages for Ollama
RUN apk add --no-cache python3 && \
    python3 -m ensurepip && \
    pip3 install --no-cache-dir --break-system-packages onnxruntime pathvalidate

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

# Start command: launch ollama serve in background, then run node server
CMD sh -c "ollama serve &" && node server.js