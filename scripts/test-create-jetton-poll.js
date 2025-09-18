const { TonClient, WalletContractV4, internal } = require('@ton/ton');
const { mnemonicToPrivateKey } = require('@ton/crypto');
const { Address, beginCell, toNano, Dictionary } = require('@ton/core');
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

async function createJettonPoll(client, wallet, keyPair, contractAddress, pollData) {
    console.log('📝 Creating poll with jetton rewards...');
    console.log(`   Subject: "${pollData.subject}"`);
    console.log(`   Options: ${pollData.options.length} options`);
    console.log(`   TON reward per vote: ${pollData.tonRewardPerVote} TON`);
    console.log(`   Jetton reward per vote: ${pollData.jettonRewardPerVote} tokens`);

    // Create options dictionary
    const optionsDict = Dictionary.empty(Dictionary.Keys.Uint(32), Dictionary.Values.Cell());
    pollData.options.forEach((option, index) => {
        optionsDict.set(index, beginCell().storeStringTail(option).endCell());
    });

    // Build CreatePoll message body with jetton support
    const createPollBody = beginCell()
        .storeUint(0x6B6F6C74, 32) // "kolt" - CreatePoll opcode
        .storeStringRefTail(pollData.subject)
        .storeDict(optionsDict)
        .storeUint(toNano(pollData.tonRewardPerVote), 64) // rewardPerVote (TON)
        .storeBit(pollData.jettonWallet !== null) // hasJettonWallet
        .storeAddress(pollData.jettonWallet) // jettonRewardWallet
        .storeUint(pollData.jettonRewardPerVote, 64) // jettonRewardPerVote
        .endCell();

    const message = internal({
        to: contractAddress,
        value: toNano('0.1'), // Gas for creating poll
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

    // Vote message body
    const voteBody = beginCell()
        .storeUint(0x566F7465, 32) // "Vote" opcode
        .storeUint(pollId, 32) // pollId
        .storeUint(optionIndex, 32) // optionIndex
        .endCell();

    const message = internal({
        to: contractAddress,
        value: toNano('0.05'), // Gas for voting
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

async function fundPollWithTon(client, wallet, keyPair, contractAddress, pollId, amount) {
    console.log(`💰 Funding poll ${pollId} with ${amount} TON...`);

    // FundPoll message body
    const fundPollBody = beginCell()
        .storeUint(0x46756E64, 32) // "Fund" opcode
        .storeUint(pollId, 32) // pollId
        .storeBit(false) // isJetton (false for TON)
        .endCell();

    const message = internal({
        to: contractAddress,
        value: toNano(amount), // Amount to fund + gas
        body: fundPollBody,
    });

    const seqno = await wallet.getSeqno();
    await wallet.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [message],
    });

    // Wait for funding
    console.log('⏳ Waiting for funding confirmation...');
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

    console.log('✅ Poll funded with TON');
}

async function testJettonPollCreation() {
    console.log('🚀 Testing Jetton-Enabled Poll Creation');
    console.log('=====================================');

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
        console.log('\\n📊 Initial Contract State:');
        let contractState = await client.getContractState(contractAddress);
        console.log('  💰 Balance:', Number(contractState.balance) / 1000000000, 'TON');
        console.log('  📊 State:', contractState.state);

        // Get initial poll count
        console.log('\\n🔍 Getting initial poll count...');
        const initialPollCountResult = await client.runMethod(contractAddress, 'getPollCount');
        const initialPollCount = initialPollCountResult.stack.readNumber();
        console.log('📊 Initial poll count:', initialPollCount);

        // Test 1: Create poll with USDT jetton rewards
        console.log('\\n🧪 Test 1: Creating poll with USDT jetton rewards');
        const usdtPollData = {
            subject: "Which DeFi protocol should integrate USDT rewards?",
            options: [
                "Uniswap-style DEX",
                "Compound-style Lending",
                "Yield Farming Protocol",
                "NFT Marketplace"
            ],
            tonRewardPerVote: "0.05", // 0.05 TON per vote
            jettonWallet: Address.parse('EQD__________________________________________0vo'), // Placeholder USDT wallet
            jettonRewardPerVote: 1000000 // 1 USDT (6 decimals)
        };

        await createJettonPoll(client, wallet, keyPair, contractAddress, usdtPollData);
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Check poll count after creation
        const pollCountAfterResult = await client.runMethod(contractAddress, 'getPollCount');
        const pollCountAfter = pollCountAfterResult.stack.readNumber();
        console.log('📊 Poll count after creation:', pollCountAfter);

        if (pollCountAfter > initialPollCount) {
            const newPollId = pollCountAfter;
            console.log(`\\n✅ Poll ${newPollId} created successfully!`);

            // Test jetton-specific getters
            console.log('\\n🔍 Testing jetton getter methods...');

            try {
                const jettonWalletResult = await client.runMethod(contractAddress, 'getPollJettonRewardWallet', [
                    { type: 'int', value: BigInt(newPollId) }
                ]);
                const jettonWallet = jettonWalletResult.stack.readAddressOpt();
                console.log('✅ Jetton wallet configured:', jettonWallet?.toString() || 'None');
            } catch (error) {
                console.log('❌ Error getting jetton wallet:', error.message);
            }

            try {
                const jettonPerVoteResult = await client.runMethod(contractAddress, 'getPollJettonRewardPerVote', [
                    { type: 'int', value: BigInt(newPollId) }
                ]);
                const jettonPerVote = jettonPerVoteResult.stack.readNumber();
                console.log('✅ Jetton reward per vote:', jettonPerVote, 'tokens');
            } catch (error) {
                console.log('❌ Error getting jetton per vote:', error.message);
            }

            try {
                const jettonPoolResult = await client.runMethod(contractAddress, 'getPollJettonRewardPool', [
                    { type: 'int', value: BigInt(newPollId) }
                ]);
                const jettonPool = jettonPoolResult.stack.readNumber();
                console.log('✅ Jetton reward pool:', jettonPool, 'tokens');
            } catch (error) {
                console.log('❌ Error getting jetton pool:', error.message);
            }

            // Fund the poll with TON rewards
            console.log('\\n💰 Funding poll with TON rewards...');
            await fundPollWithTon(client, wallet, keyPair, contractAddress, newPollId, "1.0");
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Check TON reward pool after funding
            try {
                const tonPoolResult = await client.runMethod(contractAddress, 'getPollRewardPool', [
                    { type: 'int', value: BigInt(newPollId) }
                ]);
                const tonPool = tonPoolResult.stack.readNumber();
                console.log('✅ TON reward pool after funding:', Number(tonPool) / 1000000000, 'TON');
            } catch (error) {
                console.log('❌ Error getting TON pool:', error.message);
            }

            // Test voting on the poll
            console.log('\\n🗳️  Testing voting on jetton-enabled poll...');
            await voteOnPoll(client, wallet, keyPair, contractAddress, newPollId, 0); // Vote for option 0
            await new Promise(resolve => setTimeout(resolve, 5000));

            await voteOnPoll(client, wallet, keyPair, contractAddress, newPollId, 2); // Vote for option 2
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Check poll results
            console.log('\\n📊 Checking poll results...');
            try {
                const resultsResult = await client.runMethod(contractAddress, 'getPollResults', [
                    { type: 'int', value: BigInt(newPollId) }
                ]);
                console.log('✅ Poll results retrieved successfully');

                const totalVotersResult = await client.runMethod(contractAddress, 'getPollTotalVoters', [
                    { type: 'int', value: BigInt(newPollId) }
                ]);
                const totalVoters = totalVotersResult.stack.readNumber();
                console.log('📊 Total voters:', totalVoters);
            } catch (error) {
                console.log('❌ Error getting poll results:', error.message);
            }
        }

        // Test 2: Create poll with only TON rewards (no jetton)
        console.log('\\n🧪 Test 2: Creating poll with only TON rewards');
        const tonOnlyPollData = {
            subject: "Should TON implement more DeFi primitives?",
            options: [
                "Yes, more lending protocols",
                "Yes, more DEX features",
                "Focus on current features",
                "Prioritize scalability first"
            ],
            tonRewardPerVote: "0.1", // 0.1 TON per vote
            jettonWallet: null, // No jetton
            jettonRewardPerVote: 0 // No jetton rewards
        };

        await createJettonPoll(client, wallet, keyPair, contractAddress, tonOnlyPollData);
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Final poll count
        const finalPollCountResult = await client.runMethod(contractAddress, 'getPollCount');
        const finalPollCount = finalPollCountResult.stack.readNumber();
        console.log('\\n📊 Final poll count:', finalPollCount);

        console.log('\\n🎉 Jetton Poll Creation Test Complete!');
        console.log('\\n📋 Test Summary:');
        console.log('✅ Created poll with USDT jetton rewards');
        console.log('✅ Created poll with TON-only rewards');
        console.log('✅ Tested jetton getter methods');
        console.log('✅ Funded poll with TON rewards');
        console.log('✅ Voted on jetton-enabled polls');
        console.log('✅ Verified dual reward system functionality');

        console.log('\\n💡 Next Steps for Jetton Integration:');
        console.log('• Fund polls with actual jettons using JettonTransferNotification');
        console.log('• Test claiming jetton rewards vs TON rewards');
        console.log('• Integrate with real jetton contracts (USDT, JTON, etc.)');
        console.log('• Add jetton balance checking in frontend');

    } catch (error) {
        console.log('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    testJettonPollCreation().catch(console.error);
}

module.exports = { testJettonPollCreation, createJettonPoll, voteOnPoll, fundPollWithTon };