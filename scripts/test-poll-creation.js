const { TonClient, WalletContractV4, internal } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');
const { Address, beginCell, toNano } = require('@ton/core');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function loadWallet(client) {
    if (!process.env.WALLET_MNEMONIC) {
        throw new Error('WALLET_MNEMONIC not found in .env file');
    }
    
    const mnemonic = process.env.WALLET_MNEMONIC.split(' ');
    const keyPair = await mnemonicToPrivateKey(mnemonic);
    const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    const walletContract = client.open(wallet);
    
    console.log(`💼 Wallet address: ${wallet.address.toString()}`);
    const balance = await walletContract.getBalance();
    console.log(`💰 Wallet balance: ${Number(balance) / 1000000000} TON`);
    
    return { wallet: walletContract, keyPair, address: wallet.address };
}

async function sendTonToContract(client, wallet, keyPair, contractAddress, amount) {
    console.log(`💰 Sending ${amount} TON to contract...`);
    
    const message = internal({
        to: contractAddress,
        value: toNano(amount),
        body: beginCell().endCell(), // Empty body for simple transfer
    });
    
    const seqno = await wallet.getSeqno();
    await wallet.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [message],
    });
    
    // Wait for transfer
    console.log('⏳ Waiting for transfer confirmation...');
    let currentSeqno = seqno;
    let attempts = 0;
    while (currentSeqno === seqno && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
            currentSeqno = await wallet.getSeqno();
        } catch (error) {
            // Continue waiting
        }
        attempts++;
    }
    
    console.log(`✅ Transfer completed`);
}

async function createPoll(client, wallet, keyPair, contractAddress, subject = "Test Poll Subject") {
    console.log('📝 Creating a new poll...');
    
    // CreatePoll message body (opcode 1060918784)
    const createPollBody = beginCell()
        .storeUint(1060918784, 32)  // CreatePoll opcode
        .storeStringRefTail(subject)  // Poll subject
        .endCell();
    
    const message = internal({
        to: contractAddress,
        value: toNano('0.05'), // Gas for creating poll
        body: createPollBody,
    });
    
    const seqno = await wallet.getSeqno();
    await wallet.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [message],
    });
    
    // Wait for poll creation
    console.log('⏳ Waiting for poll creation...');
    let currentSeqno = seqno;
    let attempts = 0;
    while (currentSeqno === seqno && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
            currentSeqno = await wallet.getSeqno();
        } catch (error) {
            // Continue waiting
        }
        attempts++;
    }
    
    console.log('✅ Poll creation transaction sent');
}

async function voteOnPoll(client, wallet, keyPair, contractAddress, pollId, optionIndex) {
    console.log(`🗳️  Voting on poll ${pollId}, option ${optionIndex}...`);
    
    // Vote message body (opcode 1011836453)
    const voteBody = beginCell()
        .storeUint(1011836453, 32)  // Vote opcode
        .storeInt(pollId, 257)      // pollId
        .storeInt(optionIndex, 257) // optionIndex
        .endCell();
    
    const message = internal({
        to: contractAddress,
        value: toNano('0.03'), // Gas for voting
        body: voteBody,
    });
    
    const seqno = await wallet.getSeqno();
    await wallet.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [message],
    });
    
    // Wait for vote
    console.log('⏳ Waiting for vote confirmation...');
    let currentSeqno = seqno;
    let attempts = 0;
    while (currentSeqno === seqno && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
            currentSeqno = await wallet.getSeqno();
        } catch (error) {
            // Continue waiting
        }
        attempts++;
    }
    
    console.log('✅ Vote submitted');
}

async function testContractOperations() {
    console.log('🧪 Poll Creation and Testing Script');
    console.log('==================================');

    // Load deployment info
    const deploymentPath = path.join(__dirname, '..', 'deployments', 'testnet-deployment.json');
    
    if (!fs.existsSync(deploymentPath)) {
        console.log('❌ No deployment found. Run npm run deploy:testnet first.');
        process.exit(1);
    }

    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    console.log('📍 Contract Address:', deploymentInfo.address.userFriendly);

    // Set up client and wallet
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TESTNET_API_KEY
    });

    const { wallet, keyPair } = await loadWallet(client);
    const contractAddress = Address.parse(deploymentInfo.address.userFriendly);

    try {
        // Check initial contract state
        console.log('\n📊 Initial Contract State:');
        let contractState = await client.getContractState(contractAddress);
        console.log('  💰 Balance:', Number(contractState.balance) / 1000000000, 'TON');
        console.log('  📊 State:', contractState.state);

        // Send TON to contract if balance is low
        if (contractState.balance < toNano('0.1')) {
            await sendTonToContract(client, wallet, keyPair, contractAddress, '0.2');
            
            // Wait and check updated balance
            await new Promise(resolve => setTimeout(resolve, 5000));
            contractState = await client.getContractState(contractAddress);
            console.log('  💰 Updated Balance:', Number(contractState.balance) / 1000000000, 'TON');
        }

        // Test initial poll count
        console.log('\n🔍 Testing initial poll count...');
        try {
            const pollCountResult = await client.runMethod(contractAddress, 'getPollCount');
            if (pollCountResult.stack && pollCountResult.stack.remaining > 0) {
                const initialPollCount = pollCountResult.stack.readBigNumber();
                console.log('📊 Initial poll count:', initialPollCount.toString());
            } else {
                console.log('❌ getPollCount returned empty stack');
            }
        } catch (error) {
            console.log('❌ Error getting initial poll count:', error.message);
        }

        // Create a poll
        await createPoll(client, wallet, keyPair, contractAddress, "Should TON have better DeFi ecosystem?");
        
        // Wait a bit for the transaction to be processed
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Test poll count after creation
        console.log('\n🔍 Testing poll count after creation...');
        try {
            const pollCountResult = await client.runMethod(contractAddress, 'getPollCount');
            if (pollCountResult.stack) {
                console.log('pollCountResult', pollCountResult.stack.items[0])
                const pollCount = pollCountResult.stack.items[0].value.readBigNumber();
                console.log('📊 Poll count after creation:', pollCount.toString());
                
                if (pollCount > 0n) {
                    // Test getting the poll details
                    console.log('\n📝 Getting poll details...');
                    const pollResult = await client.runMethod(contractAddress, 'getPoll', [
                        { type: 'int', value: 1n }
                    ]);
                    
                    if (pollResult.stack && pollResult.stack.remaining > 0) {
                        console.log('✅ Poll retrieved successfully');
                        const pollTuple = pollResult.stack.readTupleOpt();
                        if (pollTuple) {
                            const pollId = pollTuple.readBigNumber();
                            const creator = pollTuple.readAddress();
                            const subject = pollTuple.readString();
                            console.log('  📍 Poll ID:', pollId.toString());
                            console.log('  👤 Creator:', creator.toString());
                            console.log('  📝 Subject:', subject);
                            console.log('  ✅ Creator matches wallet:', creator.toString() === wallet.address.toString());
                        }
                    } else {
                        console.log('❌ getPoll returned empty stack');
                    }

                    // Test poll results (should be empty initially)
                    console.log('\n📊 Getting poll results...');
                    const resultsResult = await client.runMethod(contractAddress, 'getPollResults', [
                        { type: 'int', value: 1n }
                    ]);
                    
                    if (resultsResult.stack && resultsResult.stack.remaining > 0) {
                        console.log('✅ Poll results retrieved');
                        const resultsCell = resultsResult.stack.readCellOpt();
                        if (resultsCell) {
                            console.log('📊 Poll has some vote data');
                        } else {
                            console.log('📭 No votes yet (as expected)');
                        }
                    }

                    // Cast some votes
                    console.log('\n🗳️  Testing voting...');
                    await voteOnPoll(client, wallet, keyPair, contractAddress, 1, 0); // Vote for option 0
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    await voteOnPoll(client, wallet, keyPair, contractAddress, 1, 1); // Vote for option 1
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    await voteOnPoll(client, wallet, keyPair, contractAddress, 1, 0); // Another vote for option 0
                    await new Promise(resolve => setTimeout(resolve, 10000));

                    // Check results after voting
                    console.log('\n📊 Getting poll results after voting...');
                    const finalResultsResult = await client.runMethod(contractAddress, 'getPollResults', [
                        { type: 'int', value: 1n }
                    ]);
                    
                    if (finalResultsResult.stack && finalResultsResult.stack.remaining > 0) {
                        console.log('✅ Final poll results retrieved');
                        const resultsCell = finalResultsResult.stack.readCellOpt();
                        if (resultsCell) {
                            console.log('📊 Poll now has vote data!');
                        } else {
                            console.log('📭 Still no vote data visible');
                        }
                    }
                }
            } else {
                console.log('❌ getPollCount failed with exit code:', pollCountResult.exit_code);
            }
        } catch (error) {
            console.log('❌ Error getting poll count after creation:', error.message);
        }

        // Final contract state
        console.log('\n📊 Final Contract State:');
        const finalState = await client.getContractState(contractAddress);
        console.log('  💰 Final Balance:', Number(finalState.balance) / 1000000000, 'TON');

        console.log('\n🎉 Test completed!');
        console.log('📖 Summary: Created poll, cast votes, and retrieved poll data');

    } catch (error) {
        console.log('❌ Error:', error.message);
        process.exit(1);
    }
}

// Export for use in other scripts
module.exports = { testContractOperations, sendTonToContract, createPoll, voteOnPoll };

// Run if executed directly
if (require.main === module) {
    testContractOperations().catch(console.error);
}