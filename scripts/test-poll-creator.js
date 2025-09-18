const { TonClient, WalletContractV4, internal } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');
const { Address, beginCell, toNano } = require('@ton/core');
require('dotenv').config();

async function loadWallet(client) {
    if (!process.env.WALLET_MNEMONIC) {
        throw new Error('WALLET_MNEMONIC not found in .env file');
    }
    
    const mnemonic = process.env.WALLET_MNEMONIC.split(' ');
    const keyPair = await mnemonicToPrivateKey(mnemonic);
    const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    const walletContract = client.open(wallet);
    
    return { wallet: walletContract, keyPair, address: wallet.address };
}

async function testPollCreatorRetrieval() {
    console.log('🔍 Testing Poll Creator Retrieval...\n');
    
    try {
        // Initialize client
        const client = new TonClient({
            endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
            apiKey: process.env.TESTNET_API_KEY
        });
        
        // Load wallet for reference
        const { address: walletAddress } = await loadWallet(client);
        console.log('📱 Wallet address:', walletAddress.toString());
        
        // Load deployment info to get correct contract address
        const deploymentPath = require('path').join(__dirname, '..', 'deployments', 'testnet-deployment.json');
        const deploymentInfo = JSON.parse(require('fs').readFileSync(deploymentPath, 'utf8'));
        const contractAddress = Address.parse(deploymentInfo.address.userFriendly);
        console.log('📄 Contract address:', contractAddress.toString());
        
        // Test retrieving poll creator for different poll IDs
        const pollIdsToTest = [1, 15, 31];
        
        for (const pollId of pollIdsToTest) {
            console.log(`\n🔍 Testing Poll ID: ${pollId}`);
            
            try {
                // Call getPollCreator getter method
                const result = await client.runMethod(contractAddress, 'getPollCreator', [
                    { type: 'int', value: BigInt(pollId) }
                ]);
                
                if (result.stack && result.stack.items && result.stack.items.length > 0) {
                    const creatorAddress = result.stack.items[0];
                    console.log(`   📋 Raw response type: ${creatorAddress.type}`);
                    
                    if (creatorAddress.type === 'cell') {
                        const creator = creatorAddress.cell.beginParse().loadAddress();
                        console.log(`✅ Poll ${pollId} Creator: ${creator.toString()}`);
                        
                        // Check if it matches our wallet
                        if (creator.equals(walletAddress)) {
                            console.log(`   📝 This poll was created by our wallet!`);
                        } else {
                            console.log(`   👤 This poll was created by a different address`);
                        }
                    } else if (creatorAddress.type === 'slice') {
                        const creator = creatorAddress.cell.beginParse().loadAddress();
                        console.log(`✅ Poll ${pollId} Creator: ${creator.toString()}`);
                        
                        // Check if it matches our wallet
                        if (creator.equals(walletAddress)) {
                            console.log(`   📝 This poll was created by our wallet!`);
                        } else {
                            console.log(`   👤 This poll was created by a different address`);
                        }
                    } else {
                        console.log(`   ❌ Unexpected creator data type: ${creatorAddress.type}`);
                    }
                } else {
                    console.log(`   ❌ No creator data returned for poll ${pollId}`);
                }
                
            } catch (error) {
                if (error.message.includes('Poll does not exist')) {
                    console.log(`   ℹ️  Poll ${pollId} does not exist`);
                } else {
                    console.log(`   ❌ Error retrieving creator for poll ${pollId}:`, error.message);
                }
            }
        }
        
        // Also test getting poll count to see how many polls exist
        console.log(`\n📊 Checking total poll count...`);
        try {
            const countResult = await client.runMethod(contractAddress, 'getPollCount', []);
            if (countResult.stack.length > 0) {
                const pollCount = Number(countResult.stack[0].value);
                console.log(`✅ Total polls in contract: ${pollCount}`);
                
                if (pollCount > 0) {
                    console.log(`\n🎯 Testing creator retrieval for the latest poll (ID: ${pollCount})...`);
                    const latestResult = await client.runMethod(contractAddress, 'getPollCreator', [
                        { type: 'int', value: BigInt(pollCount) }
                    ]);
                    
                    if (latestResult.stack.length > 0) {
                        const creatorAddress = latestResult.stack[0];
                        if (creatorAddress.type === 'slice') {
                            const creator = creatorAddress.cell.beginParse().loadAddress();
                            console.log(`✅ Latest Poll Creator: ${creator.toString()}`);
                        }
                    }
                }
            }
        } catch (error) {
            console.log(`❌ Error getting poll count:`, error.message);
        }
        
        console.log('\n🎉 Poll creator retrieval test completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Run the test
testPollCreatorRetrieval();