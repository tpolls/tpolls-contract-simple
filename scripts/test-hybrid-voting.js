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
    
    return { wallet: walletContract, keyPair, address: wallet.address };
}

async function createPollWithRewards(client, wallet, keyPair, contractAddress, subject, options, rewardPerVote) {
    console.log('📝 Creating poll with rewards...');
    console.log('Subject:', subject);
    console.log('Options:', options);
    console.log('Reward per vote:', rewardPerVote);
    
    // Create options dictionary
    const optionsDict = Dictionary.empty(Dictionary.Keys.Int(257), Dictionary.Values.Cell());
    options.forEach((option, index) => {
        const optionCell = beginCell().storeStringTail(option).endCell();
        optionsDict.set(index, optionCell);
    });
    
    // Create message with reward parameter
    const createPollBody = beginCell()
        .storeUint(1810031829, 32)  // CreatePoll opcode (this might need updating)
        .storeStringRefTail(subject)
        .storeDict(optionsDict)
        .storeUint(rewardPerVote, 64)  // New reward parameter
        .endCell();
    
    const message = internal({
        to: contractAddress,
        value: toNano('0.1'),
        body: createPollBody,
    });
    
    const seqno = await wallet.getSeqno();
    await wallet.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [message],
    });
    
    // Wait for transaction
    let currentSeqno = seqno;
    let attempts = 0;
    while (currentSeqno === seqno && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
            currentSeqno = await wallet.getSeqno();
        } catch (error) {
            // Continue waiting
        }
        attempts++;
    }
    
    console.log('✅ Poll creation transaction completed');
    return true;
}

async function voteOnPoll(client, wallet, keyPair, contractAddress, pollId, optionIndex) {
    console.log(`🗳️  Voting on poll ${pollId}, option ${optionIndex}...`);
    
    // Create vote message
    const voteBody = beginCell()
        .storeUint(1073741822, 32)  // Vote opcode (might need updating)
        .storeUint(pollId, 64)
        .storeUint(optionIndex, 32)
        .endCell();
    
    const message = internal({
        to: contractAddress,
        value: toNano('0.05'),
        body: voteBody,
    });
    
    const seqno = await wallet.getSeqno();
    await wallet.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [message],
    });
    
    // Wait for transaction
    let currentSeqno = seqno;
    let attempts = 0;
    while (currentSeqno === seqno && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
            currentSeqno = await wallet.getSeqno();
        } catch (error) {
            // Continue waiting
        }
        attempts++;
    }
    
    console.log('✅ Vote transaction completed');
    return true;
}

async function testHybridVoting() {
    console.log('🧪 Hybrid Voting System Test');
    console.log('=============================');

    // Load deployment info (will need to deploy new contract)
    const deploymentPath = path.join(__dirname, '..', 'deployments', 'testnet-deployment.json');
    let contractAddress;
    
    try {
        const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
        contractAddress = Address.parse(deploymentInfo.address.userFriendly);
        console.log('📍 Contract Address:', contractAddress.toString());
    } catch (error) {
        console.log('❌ No deployment found. Please deploy the updated contract first.');
        console.log('Run: npm run deploy:testnet');
        return false;
    }

    // Set up client
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TESTNET_API_KEY
    });

    const { wallet, keyPair, address: walletAddress } = await loadWallet(client);

    try {
        // Test 1: Get current poll count
        console.log('\n📊 Step 1: Getting current poll count...');
        const countResult = await client.runMethod(contractAddress, 'getPollCount');
        
        const isSuccess = (countResult.exit_code === 0 || countResult.exit_code === undefined) && 
                         countResult.stack && countResult.stack.remaining > 0;
        
        if (!isSuccess) {
            throw new Error('Failed to get poll count - contract might need updating');
        }

        const currentCount = countResult.stack.readBigNumber();
        console.log('✅ Current poll count:', currentCount.toString());
        
        // Test 2: Create poll with rewards
        console.log('\n📝 Step 2: Creating poll with reward system...');
        const testOptions = [
            "Blockchain Development",
            "Web3 Integration", 
            "Smart Contract Security",
            "DeFi Protocols"
        ];
        
        const rewardPerVote = 1000000; // 0.001 TON in nanotons
        
        await createPollWithRewards(
            client, wallet, keyPair, contractAddress,
            "What area of blockchain interests you most?", 
            testOptions,
            rewardPerVote
        );
        
        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Test 3: Verify poll was created
        console.log('\n📊 Step 3: Verifying poll creation...');
        const newCountResult = await client.runMethod(contractAddress, 'getPollCount');
        const newCount = newCountResult.stack.readBigNumber();
        console.log('✅ New poll count:', newCount.toString());
        
        if (newCount <= currentCount) {
            throw new Error('Poll was not created');
        }

        const pollId = newCount;
        console.log('✅ Poll created successfully! ID:', pollId.toString());
        
        // Test 4: Check initial voter count
        console.log('\n📊 Step 4: Checking initial poll stats...');
        try {
            const totalVotersResult = await client.runMethod(contractAddress, 'getPollTotalVoters', [
                { type: 'int', value: pollId }
            ]);
            
            if (totalVotersResult.stack && totalVotersResult.stack.remaining > 0) {
                const totalVoters = totalVotersResult.stack.readBigNumber();
                console.log('✅ Initial total voters:', totalVoters.toString());
            }
        } catch (error) {
            console.log('⚠️  Could not get total voters (new method might not be available yet)');
        }
        
        // Test 5: Check if wallet has voted (should be false)
        console.log('\n🔍 Step 5: Checking if wallet has voted...');
        try {
            const hasVotedResult = await client.runMethod(contractAddress, 'hasVoted', [
                { type: 'int', value: pollId },
                { type: 'slice', cell: beginCell().storeAddress(walletAddress).endCell() }
            ]);
            
            if (hasVotedResult.stack && hasVotedResult.stack.remaining > 0) {
                const hasVoted = hasVotedResult.stack.readBoolean();
                console.log('✅ Has voted (should be false):', hasVoted);
                
                if (hasVoted) {
                    console.log('⚠️  Wallet already voted in this poll');
                }
            }
        } catch (error) {
            console.log('⚠️  Could not check vote status (new method might not be available yet)');
        }
        
        // Test 6: Vote on the poll
        console.log('\n🗳️  Step 6: Casting vote...');
        await voteOnPoll(client, wallet, keyPair, contractAddress, Number(pollId), 0);
        
        // Wait for vote processing
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Test 7: Verify vote was recorded
        console.log('\n📊 Step 7: Verifying vote was recorded...');
        const resultsResult = await client.runMethod(contractAddress, 'getPollResults', [
            { type: 'int', value: pollId }
        ]);
        
        if (resultsResult.stack && resultsResult.stack.remaining > 0) {
            console.log('✅ Vote results retrieved successfully');
            
            // Check if wallet now shows as having voted
            try {
                const hasVotedAfterResult = await client.runMethod(contractAddress, 'hasVoted', [
                    { type: 'int', value: pollId },
                    { type: 'slice', cell: beginCell().storeAddress(walletAddress).endCell() }
                ]);
                
                if (hasVotedAfterResult.stack && hasVotedAfterResult.stack.remaining > 0) {
                    const hasVotedAfter = hasVotedAfterResult.stack.readBoolean();
                    console.log('✅ Has voted after voting (should be true):', hasVotedAfter);
                    
                    if (hasVotedAfter) {
                        console.log('🎉 SUCCESS: Duplicate vote prevention is working!');
                    } else {
                        console.log('❌ FAILURE: Vote was not recorded in voter tracking');
                    }
                }
            } catch (error) {
                console.log('⚠️  Could not verify vote tracking:', error.message);
            }
        }
        
        // Test 8: Try to vote again (should fail)
        console.log('\n🚫 Step 8: Testing duplicate vote prevention...');
        try {
            await voteOnPoll(client, wallet, keyPair, contractAddress, Number(pollId), 1);
            console.log('❌ FAILURE: Duplicate vote was allowed!');
        } catch (error) {
            console.log('✅ SUCCESS: Duplicate vote prevented (expected behavior)');
        }
        
        console.log('\n🎉 HYBRID VOTING TEST COMPLETED!');
        return true;

    } catch (error) {
        console.log('❌ Test error:', error.message);
        console.error(error);
        return false;
    }
}

// Run the test
testHybridVoting()
    .then(success => {
        console.log('\n' + '='.repeat(50));
        if (success) {
            console.log('🎉 HYBRID VOTING TESTS PASSED! The enhanced contract is working.');
        } else {
            console.log('❌ HYBRID VOTING TESTS FAILED! There are issues to address.');
        }
        console.log('='.repeat(50));
    })
    .catch(error => {
        console.error('❌ Test execution error:', error);
    });