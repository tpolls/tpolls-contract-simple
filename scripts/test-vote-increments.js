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

async function createTestPoll(client, wallet, keyPair, contractAddress) {
    console.log('📝 Creating test poll...');
    
    const testOptions = [
        "Option A - Test Vote Increment",
        "Option B - Test Vote Increment", 
        "Option C - Test Vote Increment",
        "Option D - Test Vote Increment"
    ];
    
    // Create options dictionary
    const optionsDict = Dictionary.empty(Dictionary.Keys.Int(257), Dictionary.Values.Cell());
    testOptions.forEach((option, index) => {
        const optionCell = beginCell().storeStringTail(option).endCell();
        optionsDict.set(index, optionCell);
    });
    
    // Create message
    const createPollBody = beginCell()
        .storeUint(1052480048, 32)  // CreatePoll opcode
        .storeStringRefTail("Vote Increment Test Poll")
        .storeDict(optionsDict)
        .storeUint(0, 257)  // No reward for this test (note: changed from 64 to 257 bits)
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
    
    console.log('✅ Test poll created successfully');
    return true;
}

async function castVote(client, wallet, keyPair, contractAddress, pollId, optionIndex) {
    console.log(`🗳️  Casting vote for option ${optionIndex}...`);
    
    // Create vote message
    const voteBody = beginCell()
        .storeUint(1011836453, 32)  // Vote opcode
        .storeUint(pollId, 257)      // Changed from 64 to 257 bits
        .storeUint(optionIndex, 257) // Changed from 32 to 257 bits
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

async function getPollResults(client, contractAddress, pollId) {
    const resultsResult = await client.runMethod(contractAddress, 'getPollResults', [
        { type: 'int', value: BigInt(pollId) }
    ]);
    
    if (!resultsResult.stack || resultsResult.stack.remaining === 0) {
        throw new Error('Failed to get poll results');
    }
    
    // Parse the results dictionary
    const results = {};
    try {
        const cell = resultsResult.stack.readCell();
        if (cell) {
            const dict = Dictionary.loadDirect(
                Dictionary.Keys.BigInt(257),
                Dictionary.Values.BigInt(257),
                cell
            );
            
            for (let i = 0; i < 10; i++) { // Check up to 10 options
                const votes = dict.get(BigInt(i));
                if (votes !== undefined) {
                    results[i] = Number(votes);
                }
            }
        }
    } catch (error) {
        console.log('Note: Results dictionary might be empty (no votes yet)');
    }
    
    return results;
}

async function getTotalVoters(client, contractAddress, pollId) {
    try {
        const totalVotersResult = await client.runMethod(contractAddress, 'getPollTotalVoters', [
            { type: 'int', value: BigInt(pollId) }
        ]);
        
        if (totalVotersResult.stack && totalVotersResult.stack.remaining > 0) {
            return Number(totalVotersResult.stack.readBigNumber());
        }
    } catch (error) {
        console.log('Note: Could not get total voters count');
    }
    return 0;
}

async function testVoteIncrements() {
    console.log('🧪 Vote Increment Test');
    console.log('=====================');

    // Load deployment info
    const deploymentPath = path.join(__dirname, '..', 'deployments', 'testnet-deployment.json');
    let contractAddress;
    
    try {
        const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
        contractAddress = Address.parse(deploymentInfo.address.userFriendly);
        console.log('📍 Contract Address:', contractAddress.toString());
    } catch (error) {
        console.log('❌ No deployment found. Please deploy the contract first.');
        console.log('Run: npm run deploy:testnet');
        return false;
    }

    // Set up client
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TESTNET_API_KEY
    });

    const { wallet, keyPair } = await loadWallet(client);

    try {
        // Step 1: Get current poll count
        console.log('\n📊 Step 1: Getting current poll count...');
        const countResult = await client.runMethod(contractAddress, 'getPollCount');
        const currentCount = Number(countResult.stack.readBigNumber());
        console.log('✅ Current poll count:', currentCount);
        
        // Step 2: Create test poll
        console.log('\n📝 Step 2: Creating test poll...');
        await createTestPoll(client, wallet, keyPair, contractAddress);
        
        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Step 3: Get new poll ID
        console.log('\n📊 Step 3: Getting new poll ID...');
        const newCountResult = await client.runMethod(contractAddress, 'getPollCount');
        const newCount = Number(newCountResult.stack.readBigNumber());
        const pollId = newCount;
        console.log('✅ Test poll ID:', pollId);
        
        if (newCount <= currentCount) {
            throw new Error('Poll was not created');
        }
        
        // Step 4: Check initial poll results (should be empty)
        console.log('\n📊 Step 4: Checking initial poll results...');
        const initialResults = await getPollResults(client, contractAddress, pollId);
        const initialTotalVoters = await getTotalVoters(client, contractAddress, pollId);
        
        console.log('✅ Initial results:', initialResults);
        console.log('✅ Initial total voters:', initialTotalVoters);
        
        // Verify initial state
        const initialVotesOption0 = initialResults[0] || 0;
        const initialVotesOption1 = initialResults[1] || 0;
        const initialVotesOption2 = initialResults[2] || 0;
        
        console.log(`✅ Initial vote counts - Option 0: ${initialVotesOption0}, Option 1: ${initialVotesOption1}, Option 2: ${initialVotesOption2}`);
        
        // Step 5: Cast first vote (Option 0)
        console.log('\n🗳️  Step 5: Casting first vote for Option 0...');
        await castVote(client, wallet, keyPair, contractAddress, pollId, 0);
        
        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Step 6: Verify first vote incremented correctly
        console.log('\n📊 Step 6: Verifying first vote increment...');
        const afterFirstVoteResults = await getPollResults(client, contractAddress, pollId);
        const afterFirstVoteTotalVoters = await getTotalVoters(client, contractAddress, pollId);
        
        console.log('✅ Results after first vote:', afterFirstVoteResults);
        console.log('✅ Total voters after first vote:', afterFirstVoteTotalVoters);
        
        const firstVoteOption0 = afterFirstVoteResults[0] || 0;
        const firstVoteOption1 = afterFirstVoteResults[1] || 0;
        
        // Verify increments
        if (firstVoteOption0 === initialVotesOption0 + 1) {
            console.log('✅ SUCCESS: Option 0 vote count incremented correctly!');
        } else {
            console.log(`❌ FAILURE: Option 0 expected ${initialVotesOption0 + 1}, got ${firstVoteOption0}`);
        }
        
        if (firstVoteOption1 === initialVotesOption1) {
            console.log('✅ SUCCESS: Option 1 vote count remained unchanged!');
        } else {
            console.log(`❌ FAILURE: Option 1 expected ${initialVotesOption1}, got ${firstVoteOption1}`);
        }
        
        if (afterFirstVoteTotalVoters === initialTotalVoters + 1) {
            console.log('✅ SUCCESS: Total voters count incremented correctly!');
        } else {
            console.log(`❌ FAILURE: Total voters expected ${initialTotalVoters + 1}, got ${afterFirstVoteTotalVoters}`);
        }
        
        // Step 7: Try to vote again (should fail - duplicate vote prevention)
        console.log('\n🚫 Step 7: Testing duplicate vote prevention...');
        try {
            await castVote(client, wallet, keyPair, contractAddress, pollId, 1);
            
            // If we get here, wait and check if vote was actually recorded
            await new Promise(resolve => setTimeout(resolve, 15000));
            const duplicateTestResults = await getPollResults(client, contractAddress, pollId);
            const duplicateTestOption1 = duplicateTestResults[1] || 0;
            
            if (duplicateTestOption1 === firstVoteOption1) {
                console.log('✅ SUCCESS: Duplicate vote was prevented (vote count unchanged)!');
            } else {
                console.log(`❌ FAILURE: Duplicate vote was recorded! Option 1 went from ${firstVoteOption1} to ${duplicateTestOption1}`);
            }
            
        } catch (error) {
            console.log('✅ SUCCESS: Duplicate vote transaction failed (expected behavior)');
        }
        
        // Step 8: Final verification
        console.log('\n📊 Step 8: Final verification of vote counts...');
        const finalResults = await getPollResults(client, contractAddress, pollId);
        const finalTotalVoters = await getTotalVoters(client, contractAddress, pollId);
        
        console.log('✅ Final results:', finalResults);
        console.log('✅ Final total voters:', finalTotalVoters);
        
        // Summary
        console.log('\n📋 VOTE INCREMENT TEST SUMMARY:');
        console.log('================================');
        console.log(`Poll ID: ${pollId}`);
        console.log(`Initial - Option 0: ${initialVotesOption0}, Option 1: ${initialVotesOption1}, Total Voters: ${initialTotalVoters}`);
        console.log(`After Vote - Option 0: ${finalResults[0] || 0}, Option 1: ${finalResults[1] || 0}, Total Voters: ${finalTotalVoters}`);
        
        const expectedOption0 = initialVotesOption0 + 1;
        const expectedOption1 = initialVotesOption1;
        const expectedTotalVoters = initialTotalVoters + 1;
        
        const success = (
            (finalResults[0] || 0) === expectedOption0 &&
            (finalResults[1] || 0) === expectedOption1 &&
            finalTotalVoters === expectedTotalVoters
        );
        
        if (success) {
            console.log('🎉 SUCCESS: All vote increments are working correctly!');
        } else {
            console.log('❌ FAILURE: Vote increment issues detected!');
        }
        
        return success;

    } catch (error) {
        console.log('❌ Test error:', error.message);
        console.error(error);
        return false;
    }
}

// Run the test
testVoteIncrements()
    .then(success => {
        console.log('\n' + '='.repeat(50));
        if (success) {
            console.log('🎉 VOTE INCREMENT TESTS PASSED!');
            console.log('Vote counting is working correctly.');
        } else {
            console.log('❌ VOTE INCREMENT TESTS FAILED!');
            console.log('Issues found with vote counting.');
        }
        console.log('='.repeat(50));
    })
    .catch(error => {
        console.error('❌ Test execution error:', error);
    });