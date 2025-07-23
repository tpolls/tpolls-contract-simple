const { TonClient } = require('@ton/ton');
const { Address } = require('@ton/core');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function debugContractCalls() {
    console.log('🔍 Debugging Contract Method Calls');
    console.log('==================================');

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
        // Check contract state first
        console.log('\n🔍 Checking contract state...');
        const contractState = await client.getContractState(contractAddress);
        console.log('State:', contractState.state);
        console.log('Balance:', Number(contractState.balance) / 1000000000, 'TON');

        // Test basic method calls with detailed error handling
        console.log('\n📊 Testing getPollCount...');
        try {
            const countResult = await client.runMethod(contractAddress, 'getPollCount');
            console.log('Raw result:', {
                exit_code: countResult.exit_code,
                stack_remaining: countResult.stack ? countResult.stack.remaining : 'no stack',
                stack_items: countResult.stack ? countResult.stack.items : 'no items'
            });
            
            if (countResult.exit_code === 0 && countResult.stack && countResult.stack.remaining > 0) {
                const count = countResult.stack.readBigNumber();
                console.log('✅ Poll count:', count.toString());
                
                if (count > 0n) {
                    // Try to get a poll that exists
                    console.log('\n📝 Testing getPoll for poll 1...');
                    const pollResult = await client.runMethod(contractAddress, 'getPoll', [
                        { type: 'int', value: 1n }
                    ]);
                    console.log('getPoll result:', {
                        exit_code: pollResult.exit_code,
                        stack_remaining: pollResult.stack ? pollResult.stack.remaining : 'no stack'
                    });
                    
                    // Try getPollSubject (simpler method)
                    console.log('\n📝 Testing getPollSubject for poll 1...');
                    const subjectResult = await client.runMethod(contractAddress, 'getPollSubject', [
                        { type: 'int', value: 1n }
                    ]);
                    console.log('getPollSubject result:', {
                        exit_code: subjectResult.exit_code,
                        stack_remaining: subjectResult.stack ? subjectResult.stack.remaining : 'no stack'
                    });
                    
                    if (subjectResult.exit_code === 0 && subjectResult.stack && subjectResult.stack.remaining > 0) {
                        const subject = subjectResult.stack.readString();
                        console.log('✅ Poll 1 subject:', subject);
                        
                        // Now try getPollOptions
                        console.log('\n🔍 Testing getPollOptions for poll 1...');
                        const optionsResult = await client.runMethod(contractAddress, 'getPollOptions', [
                            { type: 'int', value: 1n }
                        ]);
                        console.log('getPollOptions result:', {
                            exit_code: optionsResult.exit_code,
                            stack_remaining: optionsResult.stack ? optionsResult.stack.remaining : 'no stack'
                        });
                        
                        if (optionsResult.exit_code === 0 && optionsResult.stack && optionsResult.stack.remaining > 0) {
                            console.log('✅ getPollOptions method works!');
                            const optionsCell = optionsResult.stack.readCellOpt();
                            if (optionsCell) {
                                console.log('✅ Options cell retrieved');
                                // This proves that the method works and returns data
                            } else {
                                console.log('⚠️ Empty options cell (no options stored)');
                            }
                        } else {
                            console.log('❌ getPollOptions failed with exit code:', optionsResult.exit_code);
                        }
                    } else {
                        console.log('❌ getPollSubject failed');
                    }
                }
            } else {
                console.log('❌ getPollCount failed with exit code:', countResult.exit_code);
            }
        } catch (error) {
            console.log('❌ Error in method calls:', error.message);
            console.error('Full error:', error);
        }

    } catch (error) {
        console.log('❌ Error:', error.message);
        console.error('Full error:', error);
    }
}

// Run the debug
debugContractCalls().catch(console.error);