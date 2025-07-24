const WebSocket = require('ws');
const { Address } = require('@ton/core');
require('dotenv').config();

class WebSocketEventListener {
    constructor(contractAddress) {
        this.contractAddress = Address.parse(contractAddress);
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }

    async connect() {
        try {
            // TON WebSocket endpoint (testnet)
            const wsUrl = 'wss://testnet.toncenter.com/api/v2/websocket';
            
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                console.log('🔌 WebSocket connected');
                this.reconnectAttempts = 0;
                this.subscribeToContract();
            });

            this.ws.on('message', (data) => {
                this.handleMessage(data);
            });

            this.ws.on('close', () => {
                console.log('🔌 WebSocket disconnected');
                this.handleReconnect();
            });

            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
            });

        } catch (error) {
            console.error('❌ Failed to connect WebSocket:', error);
        }
    }

    subscribeToContract() {
        const subscriptionMessage = {
            id: 1,
            jsonrpc: '2.0',
            method: 'subscribe_account',
            params: {
                account: this.contractAddress.toString(),
                operations: ['transactions']
            }
        };

        this.ws.send(JSON.stringify(subscriptionMessage));
        console.log('📡 Subscribed to contract:', this.contractAddress.toString());
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data.toString());
            
            if (message.method === 'account_transaction') {
                console.log('📦 New transaction received');
                this.processTransaction(message.params);
            }

        } catch (error) {
            console.error('❌ Error parsing WebSocket message:', error);
        }
    }

    async processTransaction(transactionData) {
        try {
            console.log('🔍 Processing transaction:', transactionData.tx_hash);
            
            // Extract vote information from transaction
            if (transactionData.in_msg && transactionData.in_msg.msg_data) {
                await this.parseVoteFromTransaction(transactionData);
            }

        } catch (error) {
            console.error('❌ Error processing transaction:', error);
        }
    }

    async parseVoteFromTransaction(transactionData) {
        // This would need to be implemented based on the actual transaction structure
        // from the TON WebSocket API
        
        console.log('🗳️  Potential vote transaction detected');
        console.log('📝 Transaction data:', JSON.stringify(transactionData, null, 2));
        
        // You would parse the message body here to extract:
        // - pollId
        // - voterAddress  
        // - optionIndex
        // - timestamp
    }

    handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.pow(2, this.reconnectAttempts) * 1000; // Exponential backoff
            
            console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
            
            setTimeout(() => {
                this.connect();
            }, delay);
        } else {
            console.error('❌ Max reconnection attempts reached');
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Example usage
async function startWebSocketListener() {
    const contractAddress = process.env.CONTRACT_ADDRESS || 'EQBTTSiLga3dkYVTrKNFQYxat2UBTkL2RxGOGp4vqjMdPdTG';
    
    const listener = new WebSocketEventListener(contractAddress);
    
    process.on('SIGINT', () => {
        listener.disconnect();
        process.exit(0);
    });

    await listener.connect();
}

if (require.main === module) {
    startWebSocketListener().catch(console.error);
}

module.exports = { WebSocketEventListener };