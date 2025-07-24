// Express middleware approach - drop this into your existing API

const express = require('express');
const { VoteIndexer } = require('./path/to/VoteIndexer'); // Adjust path

// Create vote tracking middleware that can be added to existing Express app
function createVoteTrackingMiddleware(contractAddress, mongoUrl) {
    const router = express.Router();
    let voteIndexer = null;

    // Initialize the indexer
    const initializeIndexer = async () => {
        if (!voteIndexer) {
            voteIndexer = new VoteIndexer(contractAddress, mongoUrl);
            await voteIndexer.initialize();
            voteIndexer.start(); // Start background indexing
            console.log('✅ Vote tracking middleware initialized');
        }
        return voteIndexer;
    };

    // Middleware to ensure indexer is ready
    router.use(async (req, res, next) => {
        try {
            await initializeIndexer();
            req.voteIndexer = voteIndexer;
            next();
        } catch (error) {
            console.error('❌ Vote indexer initialization failed:', error);
            res.status(503).json({ 
                success: false, 
                error: 'Vote tracking service unavailable' 
            });
        }
    });

    // Vote tracking routes
    router.get('/polls/:pollId/votes', async (req, res) => {
        try {
            const pollId = parseInt(req.params.pollId);
            const { page = 1, limit = 50 } = req.query;
            
            const votes = await req.voteIndexer.getVotesForPoll(pollId, {
                page: parseInt(page),
                limit: parseInt(limit)
            });
            
            res.json({ success: true, votes });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.get('/voters/:address/votes', async (req, res) => {
        try {
            const voterAddress = req.params.address;
            const votes = await req.voteIndexer.getVotesForVoter(voterAddress);
            res.json({ success: true, votes });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.get('/voters/:address/rewards', async (req, res) => {
        try {
            const voterAddress = req.params.address;
            const rewards = await req.voteIndexer.getUnclaimedRewards(voterAddress);
            const totalRewardValue = rewards.reduce((sum, reward) => sum + parseFloat(reward.rewardAmount || 0), 0);
            
            res.json({ 
                success: true, 
                rewards,
                totalRewardValue,
                count: rewards.length
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/rewards/claim', async (req, res) => {
        try {
            const { pollId, voterAddress, claimTransactionHash } = req.body;
            
            // Validate required fields
            if (!pollId || !voterAddress || !claimTransactionHash) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields: pollId, voterAddress, claimTransactionHash'
                });
            }

            await req.voteIndexer.markRewardClaimed(pollId, voterAddress, claimTransactionHash);
            res.json({ success: true, message: 'Reward marked as claimed' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.get('/polls/:pollId/stats', async (req, res) => {
        try {
            const pollId = parseInt(req.params.pollId);
            const stats = await req.voteIndexer.getPollStats(pollId);
            res.json({ success: true, stats });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Real-time vote feed
    router.get('/live-feed', async (req, res) => {
        try {
            // Set up Server-Sent Events for real-time vote updates
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });

            // Send initial connection confirmation
            res.write('data: {"type":"connected","message":"Vote feed connected"}\n\n');

            // Set up periodic updates (you'd implement real-time events in production)
            const interval = setInterval(async () => {
                try {
                    const recentVotes = await req.voteIndexer.getRecentVotes(5);
                    res.write(`data: ${JSON.stringify({
                        type: 'votes_update',
                        votes: recentVotes,
                        timestamp: new Date().toISOString()
                    })}\n\n`);
                } catch (error) {
                    console.error('Error sending vote update:', error);
                }
            }, 10000); // Update every 10 seconds

            // Clean up on client disconnect
            req.on('close', () => {
                clearInterval(interval);
            });

        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Administrative endpoints
    router.get('/admin/status', async (req, res) => {
        try {
            const status = {
                isIndexing: req.voteIndexer.isRunning,
                lastProcessedLt: await req.voteIndexer.getLastProcessedTransaction(),
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                nodeVersion: process.version
            };
            res.json({ success: true, status });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
}

// Usage in your existing Express app:
// 
// const app = express();
// const voteRoutes = createVoteTrackingMiddleware(
//     process.env.CONTRACT_ADDRESS,
//     process.env.MONGODB_URL
// );
// 
// app.use('/api/votes', voteRoutes);

module.exports = { createVoteTrackingMiddleware };