const { TonClient } = require('@ton/ton');
const { Address } = require('@ton/core');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function simpleContractTest() {
    console.log('🧪 Simple Contract Test');
    console.log('======================');

    // Load deployment info
    const deploymentPath = path.join(__dirname, '..', 'deployments', 'testnet-deployment.json');
    
    if (!fs.existsSync(deploymentPath)) {
        console.log('❌ No deployment found. Run npm run deploy:testnet first.');
        process.exit(1);
    }

    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    console.log('📍 Contract Address:', deploymentInfo.address.userFriendly);
    console.log('🌐 Network:', deploymentInfo.network);

    // Set up client
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TESTNET_API_KEY
    });

    try {
        const contractAddress = Address.parse(deploymentInfo.address.userFriendly);
        
        // Get basic contract info
        const accountState = await client.getContractState(contractAddress);
        console.log('\n📊 Contract Info:');
        console.log('  💰 Balance:', Number(accountState.balance) / 1000000000, 'TON');
        console.log('  📊 State:', accountState.state);

        if (accountState.state === 'active') {
            console.log('\n✅ Contract is active and ready!');
            
            // Try to get poll count
            console.log('\n🔍 Testing getPollCount...');
            try {
                const result = await client.runMethod(contractAddress, 'getPollCount');
                if (result.exit_code === 0) {
                    const pollCount = result.stack.readBigNumber();
                    console.log('✅ Poll count:', pollCount.toString());
                } else {
                    console.log('❌ getPollCount failed with exit code:', result.exit_code);
                }
            } catch (error) {
                console.log('❌ Error calling getPollCount:', error.message);
            }

            // Try to get all polls
            console.log('\n🔍 Testing getAllPolls...');
            try {
                const result = await client.runMethod(contractAddress, 'getAllPolls');
                if (result.exit_code === 0) {
                    console.log('✅ getAllPolls executed successfully');
                    const pollsCell = result.stack.readCellOpt();
                    if (pollsCell) {
                        console.log('📋 Polls data exists');
                    } else {
                        console.log('📭 No polls data yet');
                    }
                } else {
                    console.log('❌ getAllPolls failed with exit code:', result.exit_code);
                }
            } catch (error) {
                console.log('❌ Error calling getAllPolls:', error.message);
            }

        } else {
            console.log('⚠️  Contract is not active. Current state:', accountState.state);
            console.log('💡 The contract might need to be properly initialized.');
        }

        console.log('\n📖 Next Steps:');
        console.log('1. Send some TON to the contract for gas');
        console.log('2. Send CreatePoll message to create your first poll');
        console.log('3. Send Vote messages to vote on polls');
        console.log('4. Use the getter methods to retrieve poll data');

    } catch (error) {
        console.log('❌ Error:', error.message);
    }
}

// Export for use in other scripts
module.exports = { simpleContractTest };

// Run if executed directly
if (require.main === module) {
    simpleContractTest().catch(console.error);
}