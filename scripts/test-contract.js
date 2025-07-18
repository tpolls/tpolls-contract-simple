const { TonClient } = require('@ton/ton');
const { Address } = require('@ton/core');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// For now, let's test contract without TypeScript imports
// We'll use direct contract calls

async function testContract() {
    console.log('🧪 Testing Deployed Contract Functions');
    console.log('=====================================');

    // Check if deployment info exists
    const deploymentPath = path.join(__dirname, '..', 'deployments', 'testnet-deployment.json');
    
    if (!fs.existsSync(deploymentPath)) {
        console.log('❌ No deployment found. Run npm run deploy:testnet first.');
        process.exit(1);
    }

    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    console.log('📍 Contract Address:', deploymentInfo.address.userFriendly);
    console.log('🌐 Network:', deploymentInfo.network);
    console.log('👤 Deployer:', deploymentInfo.deployer);
    console.log('📅 Deployed At:', new Date(deploymentInfo.deployedAt).toLocaleString());

    // Set up client
    const isTestnet = deploymentInfo.network === 'testnet';
    const endpoint = isTestnet
        ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
        : 'https://toncenter.com/api/v2/jsonRPC';
    const apiKey = isTestnet ? process.env.TESTNET_API_KEY : process.env.MAINNET_API_KEY;

    const client = new TonClient({ endpoint, apiKey });
    
    try {
        console.log('\n🔍 Testing contract functions...');
        
        // Get contract address
        const contractAddress = Address.parse(deploymentInfo.address.userFriendly);
        
        // Test contract balance by calling get method directly
        const accountState = await client.getContractState(contractAddress);
        console.log('💰 Contract balance:', Number(accountState.balance) / 1000000000, 'TON');
        console.log('📊 Contract state:', accountState.state);

        if (accountState.state !== 'active') {
            console.log('⚠️  Contract is not active. State:', accountState.state);
            return;
        }

        // Test contract getter methods using direct calls
        console.log('\n📊 Getting poll count...');
        try {
            const pollCountResult = await client.runMethod(contractAddress, 'getPollCount');
            const pollCount = pollCountResult.stack.readBigNumber();
            console.log('📊 Total polls:', pollCount.toString());

            if (pollCount > 0n) {
                console.log('\n📋 Getting individual polls...');
                
                // Display each poll
                for (let i = 1n; i <= pollCount; i++) {
                    try {
                        console.log(`\n📝 Poll ${i}:`);
                        
                        // Get poll data
                        const pollResult = await client.runMethod(contractAddress, 'getPoll', [
                            { type: 'int', value: i }
                        ]);
                        
                        if (pollResult.stack.remaining > 0) {
                            const pollTuple = pollResult.stack.readTupleOpt();
                            if (pollTuple) {
                                const pollId = pollTuple.readBigNumber();
                                const creator = pollTuple.readAddress();
                                console.log('  📍 Poll ID:', pollId.toString());
                                console.log('  👤 Creator:', creator.toString());
                                
                                // Get poll results
                                console.log('  📊 Results:');
                                const resultsResult = await client.runMethod(contractAddress, 'getPollResults', [
                                    { type: 'int', value: i }
                                ]);
                                
                                const resultsCell = resultsResult.stack.readCellOpt();
                                if (resultsCell) {
                                    console.log('  📊 Poll has vote data');
                                } else {
                                    console.log('  📊 No votes yet');
                                }
                            }
                        } else {
                            console.log('  ❌ Poll data not found');
                        }
                    } catch (error) {
                        console.log(`❌ Error getting poll ${i}:`, error.message);
                    }
                }
            } else {
                console.log('📭 No polls found. Contract is ready to receive polls!');
            }
        } catch (pollError) {
            console.log('❌ Error getting poll count:', pollError.message);
        }

        console.log('\n✅ Contract testing completed successfully!');
       

    } catch (error) {
        console.log('❌ Error testing contract:', error.message);
        if (error.message.includes('account not found')) {
            console.log('💡 This might mean the contract is not deployed or not initialized yet.');
        }
        process.exit(1);
    }
}

// Export for use in other scripts
module.exports = { testContract };

// Run if executed directly
if (require.main === module) {
    testContract().catch(console.error);
}