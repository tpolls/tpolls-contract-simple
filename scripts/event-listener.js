const { TonClient } = require('@ton/ton');
const { Address } = require('@ton/core');
require('dotenv').config();

class VoteEventListener {
    constructor(contractAddress, mongoClient) {
        this.contractAddress = Address.parse(contractAddress);
        this.mongoClient = mongoClient;
        this.client = new TonClient({
            endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
            apiKey: process.env.TESTNET_API_KEY
        });
        this.lastProcessedLt = null;
        this.isRunning = false;
    }

    async start() {
        console.log('🎧 Starting vote event listener...');
        console.log('📍 Contract:', this.contractAddress.toString());
        
        this.isRunning = true;
        
        // Get initial last transaction
        await this.initializeLastLt();
        
        // Start polling for new transactions
        this.pollForEvents();
    }

    async initializeLastLt() {
        try {
            const state = await this.client.getContractState(this.contractAddress);
            if (state.lastTransaction) {
                this.lastProcessedLt = state.lastTransaction.lt;
                console.log('✅ Initialized from last transaction LT:', this.lastProcessedLt);
            }
        } catch (error) {
            console.log('⚠️  Could not get initial state:', error.message);
            this.lastProcessedLt = '0';
        }
    }

    async pollForEvents() {
        while (this.isRunning) {
            try {
                await this.checkForNewTransactions();
                
                // Poll every 10 seconds
                await new Promise(resolve => setTimeout(resolve, 10000));
                
            } catch (error) {
                console.error('❌ Error polling for events:', error);
                
                // Wait longer on error
                await new Promise(resolve => setTimeout(resolve, 30000));
            }
        }
    }

    async checkForNewTransactions() {
        try {
            // Get recent transactions for the contract
            const transactions = await this.client.getTransactions(this.contractAddress, {
                limit: 10,
                lt: this.lastProcessedLt,
                hash: undefined,
                to_lt: '0'
            });

            // Process transactions in chronological order (oldest first)
            const newTransactions = transactions
                .filter(tx => tx.lt > this.lastProcessedLt)
                .reverse();

            for (const transaction of newTransactions) {
                await this.processTransaction(transaction);
                this.lastProcessedLt = transaction.lt;
            }

            if (newTransactions.length > 0) {
                console.log(`📦 Processed ${newTransactions.length} new transactions`);
            }

        } catch (error) {
            console.error('❌ Error checking transactions:', error);
        }
    }

    async processTransaction(transaction) {
        try {
            // Check if transaction has outbound messages (events)
            if (transaction.outMessages && transaction.outMessages.length > 0) {
                
                for (const message of transaction.outMessages) {
                    if (message.body) {
                        await this.parseVoteEvent(message, transaction);
                    }
                }
            }

            // Check inbound messages for Vote messages
            if (transaction.inMessage && transaction.inMessage.body) {
                await this.parseVoteMessage(transaction.inMessage, transaction);
            }

        } catch (error) {
            console.error('❌ Error processing transaction:', error);
        }
    }

    async parseVoteEvent(message, transaction) {
        try {
            // Parse the message body to extract VoteEvent data
            const slice = message.body.beginParse();
            
            // VoteEvent structure: pollId, voter, optionIndex, timestamp
            // This is a simplified parser - you'd need to match your exact event structure
            
            console.log('📤 Found outbound message (potential event)');
            
            // For now, we'll extract basic info and store it
            const eventData = {
                transactionHash: transaction.hash().toString('hex'),
                timestamp: new Date(transaction.now * 1000),
                lt: transaction.lt,
                messageType: 'event',
                rawData: message.body.toString('hex')
            };

            await this.storeEventData(eventData);

        } catch (error) {
            console.log('⚠️  Could not parse as VoteEvent:', error.message);
        }
    }

    async parseVoteMessage(message, transaction) {
        try {
            const slice = message.body.beginParse();
            
            // Check if this is a Vote message (opcode check)
            const opcode = slice.loadUint(32);
            
            if (opcode === 1073741822) { // Vote opcode (you may need to update this)
                const pollId = slice.loadUint(64);
                const optionIndex = slice.loadUint(32);
                const voter = message.source;

                console.log(`🗳️  Found Vote: Poll ${pollId}, Option ${optionIndex}, Voter: ${voter}`);

                const voteData = {
                    pollId: Number(pollId),
                    voterAddress: voter ? voter.toString() : 'unknown',
                    optionIndex: Number(optionIndex),
                    timestamp: new Date(transaction.now * 1000),
                    transactionHash: transaction.hash().toString('hex'),
                    lt: transaction.lt,
                    messageType: 'vote',
                    rewardClaimed: false,
                    rewardAmount: null
                };

                await this.storeVoteData(voteData);
            }

        } catch (error) {
            console.log('⚠️  Could not parse as Vote message:', error.message);
        }
    }

    async storeEventData(eventData) {
        if (!this.mongoClient) {
            console.log('📝 Event data (no MongoDB):', eventData);
            return;
        }

        try {
            const db = this.mongoClient.db('tpolls');
            const collection = db.collection('events');
            
            await collection.insertOne({
                ...eventData,
                createdAt: new Date()
            });

            console.log('💾 Stored event data in MongoDB');

        } catch (error) {
            console.error('❌ Error storing event data:', error);
        }
    }

    async storeVoteData(voteData) {
        if (!this.mongoClient) {
            console.log('📝 Vote data (no MongoDB):', voteData);
            return;
        }

        try {
            const db = this.mongoClient.db('tpolls');
            const collection = db.collection('votes');
            
            // Use upsert to avoid duplicates
            await collection.updateOne(
                {
                    pollId: voteData.pollId,
                    voterAddress: voteData.voterAddress,
                    transactionHash: voteData.transactionHash
                },
                {
                    $set: voteData,
                    $setOnInsert: { createdAt: new Date() }
                },
                { upsert: true }
            );

            console.log('💾 Stored vote data in MongoDB');

        } catch (error) {
            console.error('❌ Error storing vote data:', error);
        }
    }

    stop() {
        console.log('🛑 Stopping event listener...');
        this.isRunning = false;
    }
}

// Example usage
async function startEventListener() {
    // Optional: Initialize MongoDB connection
    let mongoClient = null;
    
    try {
        const { MongoClient } = require('mongodb');
        const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017';
        mongoClient = new MongoClient(mongoUrl);
        await mongoClient.connect();
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.log('⚠️  MongoDB not available, will log to console only');
    }

    // Use your contract address
    const contractAddress = process.env.CONTRACT_ADDRESS || 'EQBTTSiLga3dkYVTrKNFQYxat2UBTkL2RxGOGp4vqjMdPdTG';
    
    const listener = new VoteEventListener(contractAddress, mongoClient);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        listener.stop();
        if (mongoClient) {
            mongoClient.close();
        }
        process.exit(0);
    });

    await listener.start();
}

// Run if called directly
if (require.main === module) {
    startEventListener().catch(console.error);
}

module.exports = { VoteEventListener };