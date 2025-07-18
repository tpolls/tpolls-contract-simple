const { TonClient } = require('@ton/ton');
const { TPollsDapp } = require('../build/TPollsDapp_TPollsDapp');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

describe('TPollsDapp Integration Tests', () => {
    let client;
    let contract;
    let deploymentInfo;

    beforeAll(async () => {
        // Load deployment info from manually deployed contract
        const deploymentPath = path.join(__dirname, '..', 'deployments', 'testnet-deployment.json');
        
        if (!fs.existsSync(deploymentPath)) {
            throw new Error('No deployment found. Run npm run deploy:testnet first.');
        }

        deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
        console.log('Using deployed contract at:', deploymentInfo.address.userFriendly);

        // Set up testnet client
        client = new TonClient({
            endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
            apiKey: process.env.TESTNET_API_KEY
        });

        // Connect to deployed contract
        contract = client.open(TPollsDapp.fromAddress(deploymentInfo.address.userFriendly));
    }, 30000);


    it('should get contract balance', async () => {
        const balance = await contract.getBalance();
        console.log('Contract balance:', Number(balance) / 1000000000, 'TON');
        expect(typeof balance).toBe('bigint');
        expect(balance).toBeGreaterThan(0n);
    });

    it('should get poll count from deployed contract', async () => {
        const pollCount = await contract.getGetPollCount();
        console.log('Current poll count:', pollCount.toString());
        expect(typeof pollCount).toBe('bigint');
        expect(pollCount).toBeGreaterThanOrEqual(0n);
    });

    it('should get all polls from deployed contract', async () => {
        const allPolls = await contract.getGetAllPolls();
        console.log('All polls retrieved successfully');
        expect(allPolls).toBeDefined();
        console.log('Number of polls in map:', allPolls.size);
    });

    it('should test individual poll retrieval', async () => {
        const pollCount = await contract.getGetPollCount();
        console.log('pollCount...', pollCount);
        
        if (pollCount > 0n) {
            console.log('Testing individual poll retrieval...');
            
            for (let i = 1n; i <= pollCount; i++) {
                const poll = await contract.getGetPoll(i);
                if (poll) {
                    console.log(`Poll ${i}:`, {
                        id: poll.pollId.toString(),
                        creator: poll.creator.toString()
                    });
                    
                    // Test poll results
                    const results = await contract.getGetPollResults(i);
                    console.log(`Poll ${i} results:`, results.size, 'options with votes');
                    
                    // Test poll creator getter
                    const creator = await contract.getGetPollCreator(i);
                    expect(creator?.toString()).toBe(poll.creator.toString());
                }
            }
        } else {
            console.log('No polls found in contract. Create some polls first.');
        }
    });

    it('should display contract deployment info', async () => {
        console.log('\nContract Deployment Info:');
        console.log('========================');
        console.log('Address:', deploymentInfo.address.userFriendly);
        console.log('Network:', deploymentInfo.network);
        console.log('Deployer:', deploymentInfo.deployer);
        console.log('Deployed At:', new Date(deploymentInfo.deployedAt).toLocaleString());
        
        expect(deploymentInfo.network).toBe('testnet');
        expect(deploymentInfo.contractName).toBe('TPollsDapp');
    });
});

// Helper script to test contract functions manually
async function manualContractTest() {
    console.log('Manual Contract Testing Script');
    console.log('=============================');

    // Check if deployment info exists
    const deploymentPath = path.join(__dirname, '..', 'deployments', 'testnet-deployment.json');
    
    if (!fs.existsSync(deploymentPath)) {
        console.log('❌ No deployment found. Run npm run deploy:testnet first.');
        return;
    }

    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    console.log('📍 Contract Address:', deploymentInfo.address.userFriendly);

    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TESTNET_API_KEY
    });

    const contract = client.open(TPollsDapp.fromAddress(deploymentInfo.address.userFriendly));

    try {
        console.log('\n🔍 Testing contract functions...');
        
        // Test getPollCount
        const pollCount = await contract.getGetPollCount();
        console.log('📊 Poll count:', pollCount.toString());

        // Test getAllPolls
        const allPolls = await contract.getGetAllPolls();
        console.log('📋 All polls retrieved successfully');
        
        // Display poll information
        for (let i = 1n; i <= pollCount; i++) {
            try {
                const poll = await contract.getGetPoll(i);
                if (poll) {
                    console.log(`\n📝 Poll ${i}:`);
                    console.log('  Creator:', poll.creator.toString());
                    console.log('  Poll ID:', poll.pollId.toString());
                    
                    const results = await contract.getGetPollResults(i);
                    console.log('  Results:');
                    for (let [option, votes] of results) {
                        console.log(`    Option ${option}: ${votes} votes`);
                    }
                }
            } catch (error) {
                console.log(`❌ Error getting poll ${i}:`, error.message);
            }
        }

    } catch (error) {
        console.log('❌ Error testing contract:', error.message);
    }
}

// Export the manual test function
module.exports = { manualContractTest };

// Run manual test if this file is executed directly
if (require.main === module) {
    manualContractTest();
}