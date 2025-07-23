const { TonClient, WalletContractV4, internal } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');
const { Address, beginCell, toNano, Dictionary } = require('@ton/core');
const { TPollsDapp } = require('../build/TPollsDapp_TPollsDapp.ts');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function testWithWrapper() {
    console.log('🧪 Testing with Generated Contract Wrapper');
    console.log('==========================================');

    // Load deployment info
    const deploymentPath = path.join(__dirname, '..', 'deployments', 'testnet-deployment.json');
    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const contractAddress = Address.parse(deploymentInfo.address.userFriendly);
    console.log('📍 Contract Address:', contractAddress.toString());

    // Set up client
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TESTNET_API_KEY
    });

    try {
        // Create contract instance
        const contract = TPollsDapp.fromAddress(contractAddress);
        const provider = client.provider(contractAddress);

        // Test poll count
        console.log('\n📊 Testing getPollCount...');
        const pollCount = await contract.getGetPollCount(provider);
        console.log('✅ Poll count:', pollCount.toString());

        if (pollCount > 0n) {
            // Test getting the latest poll
            console.log('\n📝 Testing getPoll for latest poll...');
            try {
                const poll = await contract.getGetPoll(provider, pollCount);
                if (poll) {
                    console.log('✅ Retrieved poll successfully:');
                    console.log('  📍 Poll ID:', poll.pollId.toString());
                    console.log('  👤 Creator:', poll.creator.toString());
                    console.log('  📝 Subject:', poll.subject);
                    console.log('  📊 Options dictionary size:', poll.options.size);
                    console.log('  📊 Results dictionary size:', poll.results.size);

                    // Test the specific getPollOptions method
                    console.log('\n🔍 Testing getPollOptions...');
                    const options = await contract.getGetPollOptions(provider, pollCount);
                    console.log('✅ Retrieved options dictionary:');
                    console.log('  📊 Options count:', options.size);

                    // Display the actual option values
                    console.log('\n📋 Option values:');
                    for (let i = 0; i < options.size; i++) {
                        const optionCell = options.get(BigInt(i));
                        if (optionCell) {
                            const optionText = optionCell.beginParse().loadStringTail();
                            console.log(`  ${i}: "${optionText}"`);
                        }
                    }

                    console.log('\n🎉 SUCCESS: Contract wrapper works and option values are accessible!');
                    return true;
                } else {
                    console.log('❌ Poll not found');
                    return false;
                }
            } catch (error) {
                console.log('❌ Error getting poll:', error.message);
                return false;
            }
        } else {
            console.log('❌ No polls found in contract');
            return false;
        }

    } catch (error) {
        console.log('❌ Error:', error.message);
        console.error(error);
        return false;
    }
}

// Run the test
testWithWrapper()
    .then(success => {
        if (success) {
            console.log('\n✅ Wrapper test passed!');
        } else {
            console.log('\n❌ Wrapper test failed!');
        }
    })
    .catch(error => {
        console.error('❌ Test error:', error);
    });