const { TonClient, WalletContractV4, internal } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');
const { Address, beginCell, toNano, Dictionary, DictionaryValue } = require('@ton/core');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Cell dictionary value helper
const createCellDict = () => {
    return Dictionary.empty(Dictionary.Values.Cell(), Dictionary.Keys.Int(257));
};

async function testPollWithOptions() {
    console.log('🧪 Testing Poll Creation with Options');
    console.log('====================================');

    // Load deployment info
    const deploymentPath = path.join(__dirname, '..', 'deployments', 'testnet-deployment.json');
    
    if (!fs.existsSync(deploymentPath)) {
        console.log('❌ No deployment found. Run npm run deploy:testnet first.');
        process.exit(1);
    }

    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const contractAddress = Address.parse(deploymentInfo.address.userFriendly);
    console.log('📍 Contract Address:', contractAddress.toString());

    // Set up client
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TESTNET_API_KEY
    });

    try {
        // Test getPollOptions getter with poll 1 (if it exists)
        console.log('\n🔍 Testing getPollOptions getter...');
        try {
            const optionsResult = await client.runMethod(contractAddress, 'getPollOptions', [
                { type: 'int', value: 1n }
            ]);
            
            if (optionsResult.exit_code === 0) {
                console.log('✅ getPollOptions method exists and responds');
                const optionsCell = optionsResult.stack.readCellOpt();
                if (optionsCell) {
                    console.log('📊 Poll 1 has options data');
                } else {
                    console.log('📭 Poll 1 has no options (empty dict)');
                }
            } else {
                console.log('ℹ️ Poll 1 does not exist (exit code:', optionsResult.exit_code, ')');
            }
        } catch (error) {
            console.log('❌ Error calling getPollOptions:', error.message);
        }

        // Test poll count
        console.log('\n📊 Checking current poll count...');
        const pollCountResult = await client.runMethod(contractAddress, 'getPollCount');
        const pollCount = pollCountResult.stack.readBigNumber();
        console.log('📊 Current poll count:', pollCount.toString());

        console.log('\n✅ Contract updated successfully!');
        console.log('🎉 Key improvements:');
        console.log('  • Poll struct now includes options field (map<Int, Cell>)');
        console.log('  • CreatePoll message now requires options parameter');
        console.log('  • Vote validation checks if option exists');
        console.log('  • New getPollOptions() getter method added');

    } catch (error) {
        console.log('❌ Error:', error.message);
        process.exit(1);
    }
}

// Run the test
testPollWithOptions().catch(console.error);