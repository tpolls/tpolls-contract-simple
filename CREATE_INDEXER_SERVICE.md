# Creating tpolls-indexer Service

## Quick Setup Guide

### 1. Create New Project

```bash
# Navigate to parent directory
cd ../

# Create new indexer service
mkdir tpolls-indexer
cd tpolls-indexer

# Initialize Node.js project
npm init -y
```

### 2. Install Dependencies

```bash
# Core dependencies
npm install express mongodb ws @ton/ton @ton/core @ton/crypto

# Development dependencies  
npm install -D nodemon jest supertest eslint

# Utility dependencies
npm install dotenv cors helmet morgan winston compression
```

### 3. Project Structure

```bash
mkdir -p src/{indexer,api/routes,database/models,utils,config}
mkdir -p tests/{unit,integration}
mkdir -p logs config
```

### 4. Copy Event Monitoring Files

Move these files from the contract project:

```bash
# From tpolls-contract-simple/scripts/
cp ../tpolls-contract-simple/scripts/event-listener.js src/indexer/
cp ../tpolls-contract-simple/scripts/vote-indexer.js src/indexer/
cp ../tpolls-contract-simple/scripts/websocket-listener.js src/indexer/
```

### 5. Environment Configuration

Create `.env`:

```env
# TON Configuration
TON_NETWORK=testnet
TONCENTER_ENDPOINT=https://testnet.toncenter.com/api/v2/jsonRPC
TONCENTER_API_KEY=your_api_key_here
CONTRACT_ADDRESS=your_contract_address_here

# MongoDB Configuration
MONGODB_URL=mongodb://localhost:27017
MONGODB_DB_NAME=tpolls

# API Server Configuration
PORT=3001
NODE_ENV=development
API_RATE_LIMIT=100

# Logging Configuration
LOG_LEVEL=info
LOG_FILE=logs/indexer.log

# Redis Configuration (optional - for caching)
REDIS_URL=redis://localhost:6379
```

### 6. Package.json Scripts

```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "index": "node src/indexer/index.js", 
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "db:migrate": "node src/database/migrate.js",
    "db:seed": "node src/database/seed.js"
  }
}
```

### 7. Docker Configuration

Create `docker-compose.yml`:

```yaml
version: '3.8'
services:
  indexer:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - MONGODB_URL=mongodb://mongo:27017
    depends_on:
      - mongo
    volumes:
      - ./logs:/app/logs

  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
    environment:
      - MONGO_INITDB_DATABASE=tpolls

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  mongo_data:
  redis_data:
```

### 8. Main Entry Points

**src/server.js** - API Server:
```javascript
const express = require('express');
const { createVoteAPI } = require('./api/server');
const { VoteIndexer } = require('./indexer/VoteIndexer');

async function startServer() {
  const indexer = new VoteIndexer();
  await indexer.initialize();
  
  const app = createVoteAPI(indexer);
  const port = process.env.PORT || 3001;
  
  app.listen(port, () => {
    console.log(`🌐 tPolls Indexer API running on port ${port}`);
  });
  
  // Start background indexing
  indexer.start();
}

startServer().catch(console.error);
```

**src/indexer/index.js** - Standalone Indexer:
```javascript
const { VoteIndexer } = require('./VoteIndexer');

async function startIndexer() {
  const indexer = new VoteIndexer();
  await indexer.initialize();
  await indexer.start();
}

startIndexer().catch(console.error);
```

### 9. Frontend Integration

Update your frontend to use the indexer API:

**src/services/tpollsIndexerApi.js**:
```javascript
class TpollsIndexerApi {
  constructor() {
    this.baseUrl = process.env.REACT_APP_INDEXER_API_URL || 'http://localhost:3001/api';
  }

  async getVotesForPoll(pollId) {
    const response = await fetch(`${this.baseUrl}/polls/${pollId}/votes`);
    return await response.json();
  }

  async getVoterHistory(address) {
    const response = await fetch(`${this.baseUrl}/voters/${address}/votes`);
    return await response.json();
  }

  async getUnclaimedRewards(address) {
    const response = await fetch(`${this.baseUrl}/voters/${address}/rewards`);
    return await response.json();
  }
}

export default new TpollsIndexerApi();
```

### 10. Benefits of This Structure

✅ **Independent Development**: Teams can work on each service separately
✅ **Technology Optimization**: Best tools for each job
✅ **Scalable Architecture**: Scale services independently  
✅ **Clean Deployment**: Deploy changes without affecting other services
✅ **Monitoring**: Dedicated monitoring and logging per service
✅ **Testing**: Isolated testing environments

### 11. Deployment Strategy

```bash
# Development
docker-compose up -d

# Production
# Deploy each service independently:
# - Contract: TON testnet/mainnet
# - Indexer: AWS/GCP/DigitalOcean
# - Frontend: Vercel/Netlify
```

This architecture provides maximum flexibility and follows microservices best practices!