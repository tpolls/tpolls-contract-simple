const { TonClient } = require('@ton/ton');
const { Address } = require('@ton/core');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function testGetters() {
    console.log('🔍 Testing Contract Getters');
    console.log('===========================');

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
        // Test poll count
        console.log('\n📊 Testing getPollCount...');
        const countResult = await client.runMethod(contractAddress, 'getPollCount');
        console.log('Exit code:', countResult.exit_code);
        console.log('Stack remaining:', countResult.stack.remaining);
        if (countResult.exit_code === 0) {
            const count = countResult.stack.readBigNumber();
            console.log('✅ Poll count:', count.toString());

            if (count > 0n) {
                // Test getting poll 1
                console.log('\n📝 Testing getPoll for poll 1...');
                const pollResult = await client.runMethod(contractAddress, 'getPoll', [
                    { type: 'int', value: 1n }
                ]);
                console.log('Exit code:', pollResult.exit_code);
                console.log('Stack remaining:', pollResult.stack.remaining);
                
                if (pollResult.exit_code === 0 && pollResult.stack.remaining > 0) {
                    console.log('✅ Poll 1 exists');
                    
                    // Test getPollOptions for poll 1
                    console.log('\n🔍 Testing getPollOptions for poll 1...');
                    const optionsResult = await client.runMethod(contractAddress, 'getPollOptions', [
                        { type: 'int', value: 1n }
                    ]);
                    console.log('Exit code:', optionsResult.exit_code);
                    console.log('Stack remaining:', optionsResult.stack.remaining);
                    
                    if (optionsResult.exit_code === 0) {
                        console.log('✅ getPollOptions works!');
                    } else {
                        console.log('❌ getPollOptions failed');
                    }

                    // Test getPollSubject for poll 1
                    console.log('\n📝 Testing getPollSubject for poll 1...');
                    const subjectResult = await client.runMethod(contractAddress, 'getPollSubject', [
                        { type: 'int', value: 1n }
                    ]);
                    console.log('Exit code:', subjectResult.exit_code);
                    console.log('Stack remaining:', subjectResult.stack.remaining);
                    
                    if (subjectResult.exit_code === 0 && subjectResult.stack.remaining > 0) {
                        const subject = subjectResult.stack.readString();
                        console.log('✅ Poll subject:', subject);
                    } else {
                        console.log('❌ getPollSubject failed');
                    }
                } else {
                    console.log('❌ Poll 1 does not exist');
                }
            }
        } else {
            console.log('❌ getPollCount failed');
        }

    } catch (error) {
        console.log('❌ Error:', error.message);
    }
}

testGetters().catch(console.error);