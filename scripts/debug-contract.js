const { TonClient, WalletContractV4, internal } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');
const { Address, beginCell, toNano } = require('@ton/core');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function debugContract() {
    console.log('🔍 Contract Debug Script');
    console.log('========================');

    // Load deployment info
    const deploymentPath = path.join(__dirname, '..', 'deployments', 'testnet-deployment.json');
    
    if (!fs.existsSync(deploymentPath)) {
        console.log('❌ No deployment found.');
        process.exit(1);
    }

    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    console.log('📍 Contract Address:', deploymentInfo.address.userFriendly);

    // Set up client
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TESTNET_API_KEY
    });

    // Set up wallet
    const mnemonic = process.env.WALLET_MNEMONIC.split(' ');
    const keyPair = await mnemonicToPrivateKey(mnemonic);
    const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    const walletContract = client.open(wallet);

    const contractAddress = Address.parse(deploymentInfo.address.userFriendly);

    try {
        // Detailed contract state
        console.log('\n📊 Detailed Contract Analysis:');
        const contractState = await client.getContractState(contractAddress);
        
        console.log('  📍 Address:', contractAddress.toString());
        console.log('  💰 Balance:', Number(contractState.balance) / 1000000000, 'TON');
        console.log('  📊 State:', contractState.state);
        console.log('  🏗️  Has Code:', contractState.code ? 'Yes' : 'No');
        console.log('  📝 Has Data:', contractState.data ? 'Yes' : 'No');
        
        // Check if contract has code and data
        if (!contractState.code) {
            console.log('❌ Contract has no code! This means deployment failed.');
            return;
        }
        
        if (!contractState.data) {
            console.log('❌ Contract has no data! This means initialization failed.');
            return;
        }

        console.log('✅ Contract has both code and data');

        // Try a simple transfer first
        console.log('\n💰 Attempting simple transfer...');
        const transferMessage = internal({
            to: contractAddress,
            value: toNano('0.1'),
            body: beginCell().endCell(), // Empty body
        });

        const seqno = await walletContract.getSeqno();
        console.log('📝 Wallet seqno before transfer:', seqno);
        
        await walletContract.sendTransfer({
            seqno,
            secretKey: keyPair.secretKey,
            messages: [transferMessage],
        });

        // Wait and check
        console.log('⏳ Waiting 15 seconds for transfer...');
        await new Promise(resolve => setTimeout(resolve, 15000));

        const newSeqno = await walletContract.getSeqno();
        console.log('📝 Wallet seqno after transfer:', newSeqno);
        
        if (newSeqno > seqno) {
            console.log('✅ Transfer transaction was processed');
        } else {
            console.log('❌ Transfer transaction may have failed or is still pending');
        }

        // Check contract balance again
        const updatedState = await client.getContractState(contractAddress);
        console.log('💰 Updated contract balance:', Number(updatedState.balance) / 1000000000, 'TON');

        // Try calling methods with more detailed error reporting
        console.log('\n🔍 Testing contract methods with detailed errors:');
        
        try {
            console.log('Testing getPollCount...');
            const result = await client.runMethod(contractAddress, 'getPollCount');
            console.log('📊 Method result properties:', Object.keys(result));
            console.log('  Gas used:', result.gas_used);
            console.log('  Stack size:', result.stack ? result.stack.remaining : 'No stack');
            
            // Try to read the result
            if (result.stack && result.stack.remaining > 0) {
                try {
                    const pollCount = result.stack.readBigNumber();
                    console.log('  📊 Poll count:', pollCount.toString());
                    console.log('  ✅ SUCCESS! getPollCount worked - Contract is functional!');
                } catch (stackError) {
                    console.log('  ❌ Error reading stack:', stackError.message);
                }
            } else {
                console.log('  ❌ Empty or invalid stack');
            }
        } catch (error) {
            console.log('❌ Error calling getPollCount:', error.message);
            console.log('📝 Full error:', error);
        }

        // Check if we can call getAllPolls
        try {
            console.log('\nTesting getAllPolls...');
            const result = await client.runMethod(contractAddress, 'getAllPolls');
            console.log('📊 getAllPolls result:');
            console.log('  Exit code:', result.exit_code);
            console.log('  Gas used:', result.gas_used);
            console.log('  Stack size:', result.stack.remaining);
            
            if (result.exit_code === 0) {
                console.log('  ✅ getAllPolls succeeded');
            } else {
                console.log('  ❌ getAllPolls failed with exit code:', result.exit_code);
            }
        } catch (error) {
            console.log('❌ Error calling getAllPolls:', error.message);
        }

        // Test Deploy message to ensure contract is properly initialized
        console.log('\n🚀 Sending Deploy message to ensure initialization...');
        const deployBody = beginCell()
            .storeUint(2490013878, 32)  // Deploy opcode
            .storeUint(0, 64)  // queryId
            .endCell();

        const deployMessage = internal({
            to: contractAddress,
            value: toNano('0.05'),
            body: deployBody,
        });

        const deploySeqno = await walletContract.getSeqno();
        await walletContract.sendTransfer({
            seqno: deploySeqno,
            secretKey: keyPair.secretKey,
            messages: [deployMessage],
        });

        console.log('⏳ Waiting for Deploy message...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Test again after Deploy
        console.log('\n🔍 Testing after Deploy message:');
        try {
            const result = await client.runMethod(contractAddress, 'getPollCount');
            console.log('📊 Post-deploy getPollCount:');
            console.log('  Exit code:', result.exit_code);
            
            if (result.exit_code === 0) {
                const pollCount = result.stack.readBigNumber();
                console.log('  📊 Poll count:', pollCount.toString());
                console.log('  ✅ SUCCESS! Contract is now working');
            } else {
                console.log('  ❌ Still failing with exit code:', result.exit_code);
            }
        } catch (error) {
            console.log('❌ Still error after Deploy:', error.message);
        }

        // Final state check
        const finalState = await client.getContractState(contractAddress);
        console.log('\n📊 Final Contract State:');
        console.log('  💰 Balance:', Number(finalState.balance) / 1000000000, 'TON');
        console.log('  📊 State:', finalState.state);

    } catch (error) {
        console.log('❌ Debug error:', error.message);
        console.log('📝 Full error:', error);
    }
}

// Run if executed directly
if (require.main === module) {
    debugContract().catch(console.error);
}