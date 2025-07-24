// Integration guide for existing backend API on port 3001

// ====================================
// Option 1: Add to Existing Express App
// ====================================

// In your existing server.js or app.js file:

const express = require('express');
const { VoteIndexer } = require('./services/VoteIndexer'); // Move the indexer here

class ExistingApiWithVoteTracking {
    constructor() {
        this.app = express();
        this.voteIndexer = null;
        this.setupMiddleware();
        this.setupRoutes();
    }

    async initialize() {
        // Initialize vote indexer
        this.voteIndexer = new VoteIndexer(
            process.env.CONTRACT_ADDRESS,
            process.env.MONGODB_URL
        );
        await this.voteIndexer.initialize();
        
        // Start background indexing
        this.voteIndexer.start();
        
        console.log('✅ Vote tracking integrated into existing API');
    }

    setupMiddleware() {
        this.app.use(express.json());
        // ... your existing middleware
    }

    setupRoutes() {
        // Your existing routes
        this.app.get('/api/health', (req, res) => {
            res.json({ status: 'ok', service: 'tpolls-api' });
        });

        // Add vote tracking routes under /api/votes namespace
        this.setupVoteRoutes();
        
        // Your other existing routes...
    }

    setupVoteRoutes() {
        // Vote tracking routes
        this.app.get('/api/votes/polls/:pollId', async (req, res) => {
            try {
                const pollId = parseInt(req.params.pollId);
                const votes = await this.voteIndexer.getVotesForPoll(pollId);
                res.json({ success: true, votes });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.app.get('/api/votes/voters/:address', async (req, res) => {
            try {
                const voterAddress = req.params.address;
                const votes = await this.voteIndexer.getVotesForVoter(voterAddress);
                res.json({ success: true, votes });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.app.get('/api/votes/rewards/:address', async (req, res) => {
            try {
                const voterAddress = req.params.address;
                const rewards = await this.voteIndexer.getUnclaimedRewards(voterAddress);
                res.json({ success: true, rewards });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.app.get('/api/votes/stats/:pollId', async (req, res) => {
            try {
                const pollId = parseInt(req.params.pollId);
                const stats = await this.voteIndexer.getPollStats(pollId);
                res.json({ success: true, stats });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.app.post('/api/votes/rewards/claim', async (req, res) => {
            try {
                const { pollId, voterAddress, claimTransactionHash } = req.body;
                await this.voteIndexer.markRewardClaimed(pollId, voterAddress, claimTransactionHash);
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Admin routes for vote tracking management
        this.app.get('/api/votes/admin/status', async (req, res) => {
            try {
                const status = {
                    isIndexing: this.voteIndexer.isRunning,
                    lastProcessedLt: await this.voteIndexer.getLastProcessedTransaction(),
                    uptime: process.uptime()
                };
                res.json({ success: true, status });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.app.post('/api/votes/admin/reindex', async (req, res) => {
            try {
                // Restart indexing from a specific point
                const { fromLt } = req.body;
                await this.voteIndexer.restartFromLt(fromLt);
                res.json({ success: true, message: 'Reindexing started' });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });
    }

    async start(port = 3001) {
        await this.initialize();
        
        this.app.listen(port, () => {
            console.log(`🌐 Enhanced tPolls API with vote tracking running on port ${port}`);
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('🛑 Shutting down gracefully...');
            if (this.voteIndexer) {
                await this.voteIndexer.stop();
            }
            process.exit(0);
        });
    }
}

// Export for use in your existing server
module.exports = { ExistingApiWithVoteTracking };

// If you want to start this directly:
// const api = new ExistingApiWithVoteTracking();
// api.start();