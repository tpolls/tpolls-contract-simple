# Integrating Vote Tracking into Existing Backend API

## Quick Integration Steps

### Step 1: Choose Your Approach

| Approach | Best For | Complexity | Benefits |
|----------|----------|------------|----------|
| **Add Routes to Existing API** | Small teams, simple setup | Low | Single codebase, shared resources |
| **Reverse Proxy (Nginx)** | Production, multiple services | Medium | Service isolation, load balancing |
| **Express Router Middleware** | Modular approach | Low | Easy to add/remove, clean separation |
| **Separate Microservice** | Large teams, scalability | High | Independent scaling, technology choice |

### Step 2A: Middleware Approach (Recommended)

```javascript
// In your existing server.js
const express = require('express');
const { createVoteTrackingMiddleware } = require('./integration/vote-routes-middleware');

const app = express();

// Your existing middleware and routes
app.use(express.json());
app.use('/api/users', userRoutes);
app.use('/api/polls', pollRoutes);

// Add vote tracking middleware
const voteRoutes = createVoteTrackingMiddleware(
    process.env.CONTRACT_ADDRESS,
    process.env.MONGODB_URL
);
app.use('/api/votes', voteRoutes);

app.listen(3001, () => {
    console.log('API server with vote tracking running on port 3001');
});
```

### Step 2B: Direct Integration Approach

```javascript
// Copy VoteIndexer class to your project
const { VoteIndexer } = require('./services/VoteIndexer');

class YourExistingAPI {
    constructor() {
        this.app = express();
        this.voteIndexer = null;
    }

    async initialize() {
        // Initialize vote indexer
        this.voteIndexer = new VoteIndexer(
            process.env.CONTRACT_ADDRESS,
            process.env.MONGODB_URL
        );
        await this.voteIndexer.initialize();
        this.voteIndexer.start();
    }

    setupRoutes() {
        // Your existing routes...
        
        // Add vote tracking routes
        this.app.get('/api/votes/polls/:pollId', async (req, res) => {
            const votes = await this.voteIndexer.getVotesForPoll(req.params.pollId);
            res.json({ success: true, votes });
        });
        
        // ... other vote routes
    }
}
```

### Step 3: Update Frontend API Calls

```javascript
// In your frontend service file
class TpollsApi {
    constructor() {
        this.baseUrl = 'http://localhost:3001/api'; // Your existing API
    }

    // Existing methods...
    async createPoll(pollData) { /* existing */ }
    async getPolls() { /* existing */ }

    // NEW: Vote tracking methods
    async getVotesForPoll(pollId) {
        const response = await fetch(`${this.baseUrl}/votes/polls/${pollId}`);
        return await response.json();
    }

    async getVoterHistory(address) {
        const response = await fetch(`${this.baseUrl}/votes/voters/${address}`);
        return await response.json();
    }

    async getUnclaimedRewards(address) {
        const response = await fetch(`${this.baseUrl}/votes/voters/${address}/rewards`);
        return await response.json();
    }

    async claimReward(pollId, voterAddress, txHash) {
        const response = await fetch(`${this.baseUrl}/votes/rewards/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pollId, voterAddress, claimTransactionHash: txHash })
        });
        return await response.json();
    }
}
```

### Step 4: Environment Variables

Add to your existing `.env`:

```env
# Existing vars...

# Vote tracking configuration
CONTRACT_ADDRESS=EQBTTSiLga3dkYVTrKNFQYxat2UBTkL2RxGOGp4vqjMdPdTG
TONCENTER_API_KEY=your_api_key_here
MONGODB_URL=mongodb://localhost:27017
```

### Step 5: Package Dependencies

Add to your existing `package.json`:

```bash
npm install @ton/ton @ton/core @ton/crypto mongodb ws
```

### Step 6: File Structure

```
your-existing-api/
├── src/
│   ├── routes/
│   │   ├── users.js          # existing
│   │   ├── polls.js          # existing
│   │   └── votes.js          # NEW: vote tracking routes
│   ├── services/
│   │   ├── userService.js    # existing
│   │   ├── pollService.js    # existing
│   │   └── VoteIndexer.js    # NEW: copy from our scripts
│   ├── middleware/
│   │   └── voteTracking.js   # NEW: vote tracking middleware
│   └── server.js             # modify existing
├── package.json              # add new dependencies
└── .env                      # add new variables
```

## Available Endpoints After Integration

```
GET  /api/votes/polls/:pollId        # Get votes for specific poll
GET  /api/votes/voters/:address      # Get voting history for address
GET  /api/votes/voters/:address/rewards  # Get unclaimed rewards
POST /api/votes/rewards/claim        # Mark reward as claimed
GET  /api/votes/polls/:pollId/stats  # Get poll statistics
GET  /api/votes/live-feed           # Real-time vote updates (SSE)
GET  /api/votes/admin/status        # Admin: indexer status
```

## Benefits of This Approach

✅ **No Port Conflicts**: Uses your existing port 3001
✅ **Unified API**: All endpoints under one service
✅ **Shared Resources**: Database connections, middleware, etc.
✅ **Easy Deployment**: No additional infrastructure needed
✅ **Consistent Auth**: Use your existing authentication
✅ **Single Codebase**: Easier maintenance and monitoring

This integration gives you all the benefits of blockchain vote tracking while keeping your existing API architecture intact!