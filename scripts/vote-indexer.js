const { TonClient } = require('@ton/ton');
const { Address } = require('@ton/core');
const { MongoClient } = require('mongodb');
require('dotenv').config();

class VoteIndexer {
    constructor(contractAddress, mongoUrl) {
        this.contractAddress = Address.parse(contractAddress);
        this.mongoUrl = mongoUrl;
        this.client = new TonClient({
            endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
            apiKey: process.env.TESTNET_API_KEY
        });
        this.mongoClient = null;
        this.db = null;
        this.isRunning = false;
    }

    async initialize() {
        // Connect to MongoDB
        this.mongoClient = new MongoClient(this.mongoUrl);
        await this.mongoClient.connect();
        this.db = this.mongoClient.db('tpolls');
        
        // Create indexes for efficient querying
        await this.createIndexes();
        
        console.log('✅ Vote indexer initialized');
    }

    async createIndexes() {
        const votesCollection = this.db.collection('votes');
        const eventsCollection = this.db.collection('events');
        
        // Create indexes for votes collection
        await votesCollection.createIndex({ pollId: 1, voterAddress: 1 }, { unique: true });
        await votesCollection.createIndex({ voterAddress: 1 });
        await votesCollection.createIndex({ pollId: 1 });
        await votesCollection.createIndex({ timestamp: -1 });
        await votesCollection.createIndex({ rewardClaimed: 1 });
        
        // Create indexes for events collection
        await eventsCollection.createIndex({ transactionHash: 1 }, { unique: true });
        await eventsCollection.createIndex({ timestamp: -1 });
        
        console.log('✅ Database indexes created');
    }

    async start() {
        this.isRunning = true;
        console.log('🚀 Starting vote indexer...');
        
        while (this.isRunning) {
            try {
                await this.indexRecentVotes();
                
                // Index every 30 seconds
                await new Promise(resolve => setTimeout(resolve, 30000));
                
            } catch (error) {
                console.error('❌ Indexing error:', error);
                
                // Wait longer on error
                await new Promise(resolve => setTimeout(resolve, 60000));
            }
        }
    }

    async indexRecentVotes() {
        try {
            // Get the last processed transaction from database
            const lastProcessed = await this.getLastProcessedTransaction();
            
            // Get recent transactions from the contract
            const transactions = await this.client.getTransactions(this.contractAddress, {
                limit: 50,
                lt: lastProcessed,
            });

            const newTransactions = transactions
                .filter(tx => tx.lt > lastProcessed)
                .reverse(); // Process oldest first

            for (const transaction of newTransactions) {
                await this.processTransaction(transaction);
            }

            if (newTransactions.length > 0) {
                console.log(`📦 Indexed ${newTransactions.length} new transactions`);
            }

        } catch (error) {
            console.error('❌ Error indexing votes:', error);
        }
    }

    async getLastProcessedTransaction() {
        try {
            const metaCollection = this.db.collection('indexer_meta');
            const lastProcessed = await metaCollection.findOne({ _id: 'last_processed_lt' });
            
            return lastProcessed ? lastProcessed.value : '0';
            
        } catch (error) {
            console.log('⚠️  Could not get last processed LT, starting from beginning');
            return '0';
        }
    }

    async updateLastProcessedTransaction(lt) {
        try {
            const metaCollection = this.db.collection('indexer_meta');
            await metaCollection.updateOne(
                { _id: 'last_processed_lt' },
                { $set: { value: lt, updatedAt: new Date() } },
                { upsert: true }
            );
        } catch (error) {
            console.error('❌ Error updating last processed LT:', error);
        }
    }

    async processTransaction(transaction) {
        try {
            // Check for Vote messages in inbound messages
            if (transaction.inMessage && transaction.inMessage.body) {
                await this.parseVoteMessage(transaction.inMessage, transaction);
            }

            // Update last processed LT
            await this.updateLastProcessedTransaction(transaction.lt);

        } catch (error) {
            console.error('❌ Error processing transaction:', error);
        }
    }

    async parseVoteMessage(message, transaction) {
        try {
            const slice = message.body.beginParse();
            const opcode = slice.loadUint(32);
            
            // Check if this is a Vote message
            if (opcode === 1073741822) { // Vote opcode
                const pollId = slice.loadUint(64);
                const optionIndex = slice.loadUint(32);
                const voterAddress = message.source ? message.source.toString() : null;

                if (voterAddress) {
                    const voteData = {
                        pollId: Number(pollId),
                        voterAddress,
                        optionIndex: Number(optionIndex),
                        timestamp: new Date(transaction.now * 1000),
                        transactionHash: transaction.hash().toString('hex'),
                        lt: transaction.lt,
                        rewardClaimed: false,
                        rewardAmount: null,
                        createdAt: new Date()
                    };

                    await this.storeVote(voteData);
                    console.log(`🗳️  Indexed vote: Poll ${pollId}, Voter: ${voterAddress.slice(0, 10)}...`);
                }
            }

        } catch (error) {
            // Not a vote message, ignore
        }
    }

    async storeVote(voteData) {
        try {
            const votesCollection = this.db.collection('votes');
            
            // Use upsert to avoid duplicates
            await votesCollection.updateOne(
                {
                    pollId: voteData.pollId,
                    voterAddress: voteData.voterAddress
                },
                {
                    $set: voteData,
                    $setOnInsert: { indexedAt: new Date() }
                },
                { upsert: true }
            );

        } catch (error) {
            if (error.code === 11000) {
                // Duplicate key error - vote already exists
                console.log('ℹ️  Vote already indexed');
            } else {
                throw error;
            }
        }
    }

    // API methods for querying votes
    async getVotesForPoll(pollId) {
        const votesCollection = this.db.collection('votes');
        return await votesCollection.find({ pollId }).toArray();
    }

    async getVotesForVoter(voterAddress) {
        const votesCollection = this.db.collection('votes');
        return await votesCollection.find({ voterAddress }).toArray();
    }

    async getUnclaimedRewards(voterAddress) {
        const votesCollection = this.db.collection('votes');
        return await votesCollection.find({
            voterAddress,
            rewardClaimed: false,
            rewardAmount: { $gt: 0 }
        }).toArray();
    }

    async markRewardClaimed(pollId, voterAddress, claimTransactionHash) {
        const votesCollection = this.db.collection('votes');
        await votesCollection.updateOne(
            { pollId, voterAddress },
            {
                $set: {
                    rewardClaimed: true,
                    claimTransactionHash,
                    claimedAt: new Date()
                }
            }
        );
    }

    async getPollStats(pollId) {
        const votesCollection = this.db.collection('votes');
        
        const totalVotes = await votesCollection.countDocuments({ pollId });
        const voteBreakdown = await votesCollection.aggregate([
            { $match: { pollId } },
            { $group: { _id: '$optionIndex', count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]).toArray();

        return {
            totalVotes,
            voteBreakdown: voteBreakdown.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {})
        };
    }

    async stop() {
        this.isRunning = false;
        if (this.mongoClient) {
            await this.mongoClient.close();
        }
        console.log('🛑 Vote indexer stopped');
    }
}

// Express API for querying votes
function createVoteAPI(indexer) {
    const express = require('express');
    const app = express();
    
    app.use(express.json());

    // Get votes for a specific poll
    app.get('/api/polls/:pollId/votes', async (req, res) => {
        try {
            const pollId = parseInt(req.params.pollId);
            const votes = await indexer.getVotesForPoll(pollId);
            res.json({ success: true, votes });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get votes for a specific voter
    app.get('/api/voters/:address/votes', async (req, res) => {
        try {
            const voterAddress = req.params.address;
            const votes = await indexer.getVotesForVoter(voterAddress);
            res.json({ success: true, votes });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get unclaimed rewards for a voter
    app.get('/api/voters/:address/rewards', async (req, res) => {
        try {
            const voterAddress = req.params.address;
            const rewards = await indexer.getUnclaimedRewards(voterAddress);
            res.json({ success: true, rewards });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get poll statistics
    app.get('/api/polls/:pollId/stats', async (req, res) => {
        try {
            const pollId = parseInt(req.params.pollId);
            const stats = await indexer.getPollStats(pollId);
            res.json({ success: true, stats });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Mark reward as claimed
    app.post('/api/rewards/claim', async (req, res) => {
        try {
            const { pollId, voterAddress, claimTransactionHash } = req.body;
            await indexer.markRewardClaimed(pollId, voterAddress, claimTransactionHash);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return app;
}

// Example usage
async function startVoteIndexer() {
    const contractAddress = process.env.CONTRACT_ADDRESS || 'EQBTTSiLga3dkYVTrKNFQYxat2UBTkL2RxGOGp4vqjMdPdTG';
    const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017';
    
    const indexer = new VoteIndexer(contractAddress, mongoUrl);
    await indexer.initialize();
    
    // Start the API server
    const app = createVoteAPI(indexer);
    const port = process.env.PORT || 3001;
    app.listen(port, () => {
        console.log(`🌐 Vote API server running on port ${port}`);
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        await indexer.stop();
        process.exit(0);
    });

    // Start indexing
    await indexer.start();
}

if (require.main === module) {
    startVoteIndexer().catch(console.error);
}

module.exports = { VoteIndexer, createVoteAPI };