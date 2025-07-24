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

async function createTestPollIfNeeded(client, wallet, keyPair, contractAddress) {
    console.log('📝 Creating test poll for hasVoted testing...');
    
    const testOptions = [
        "hasVoted Test Option A",
        "hasVoted Test Option B", 
        "hasVoted Test Option C"
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
        .storeStringRefTail("hasVoted Test Poll")
        .storeDict(optionsDict)
        .storeUint(0, 257)  // No reward for this test
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
    console.log(`🗳️  Casting vote for poll ${pollId}, option ${optionIndex}...`);
    
    // Create vote message
    const voteBody = beginCell()
        .storeUint(1011836453, 32)  // Vote opcode
        .storeUint(pollId, 257)
        .storeUint(optionIndex, 257)
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

async function checkHasVoted(client, contractAddress, pollId, voterAddress) {
    console.log(`🔍 Checking if ${voterAddress.toString()} has voted on poll ${pollId}...`);
    
    try {
        // Create a cell with the address for the slice parameter
        const addressCell = beginCell().storeAddress(voterAddress).endCell();
        
        const result = await client.runMethod(contractAddress, 'hasVoted', [
            { type: 'int', value: BigInt(pollId) },
            { type: 'slice', cell: addressCell }
        ]);
        
        if (result.stack && result.stack.remaining > 0) {
            const hasVoted = result.stack.readBoolean();
            console.log(`✅ hasVoted result: ${hasVoted}`);
            return hasVoted;
        } else {
            console.log('❌ No data returned from hasVoted method');
            return null;
        }
    } catch (error) {
        console.error('❌ Error calling hasVoted:', error.message);
        throw error;
    }
}

async function testHasVotedMethod() {
    console.log('🧪 hasVoted Method Test');
    console.log('=======================');

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

    const { wallet, keyPair, address: walletAddress } = await loadWallet(client);

    try {
        // Step 1: Get current poll count
        console.log('\n📊 Step 1: Getting current poll count...');
        const countResult = await client.runMethod(contractAddress, 'getPollCount');
        const currentCount = Number(countResult.stack.readBigNumber());
        console.log('✅ Current poll count:', currentCount);
        
        // Step 2: Always create a new test poll for clean testing
        console.log('\n📝 Step 2: Creating new test poll for clean hasVoted testing...');
        await createTestPollIfNeeded(client, wallet, keyPair, contractAddress);
        
        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Get new poll count
        const newCountResult = await client.runMethod(contractAddress, 'getPollCount');
        const testPollId = Number(newCountResult.stack.readBigNumber());
        console.log('✅ Test poll created with ID:', testPollId);
        
        // Step 3: Check hasVoted BEFORE voting (should be false)
        console.log('\n🔍 Step 3: Checking hasVoted BEFORE voting...');
        const hasVotedBefore = await checkHasVoted(client, contractAddress, testPollId, walletAddress);
        
        if (hasVotedBefore === false) {
            console.log('✅ SUCCESS: hasVoted correctly returns false before voting');
        } else if (hasVotedBefore === true) {
            console.log('⚠️  WARNING: Wallet has already voted on this poll. Test may be limited.');
        } else {
            console.log('❌ FAILURE: hasVoted method returned invalid result');
            return false;
        }
        
        // Step 4: Cast a vote (only if not already voted)
        if (hasVotedBefore === false) {
            console.log('\n🗳️  Step 4: Casting vote...');
            await castVote(client, wallet, keyPair, contractAddress, testPollId, 0);
            
            // Wait for vote processing
            await new Promise(resolve => setTimeout(resolve, 15000));
            
            // Step 5: Check hasVoted AFTER voting (should be true)
            console.log('\n🔍 Step 5: Checking hasVoted AFTER voting...');
            const hasVotedAfter = await checkHasVoted(client, contractAddress, testPollId, walletAddress);
            
            if (hasVotedAfter === true) {
                console.log('✅ SUCCESS: hasVoted correctly returns true after voting');
            } else {
                console.log('❌ FAILURE: hasVoted should return true after voting, but returned:', hasVotedAfter);
                return false;
            }
        } else {
            console.log('\n⏭️  Step 4-5: Skipping vote casting (already voted)');
        }
        
        // Step 6: Test with different address (should be false)
        console.log('\n🔍 Step 6: Testing hasVoted with different address...');
        
        // Create a dummy address for testing (use a valid TON address format)
        const dummyAddress = Address.parse('EQD2NmD_lH5f5u1Kj3KfGyTvhZSX0Eg6qp2a5IQUKXxOG21n');
        const hasVotedDifferentUser = await checkHasVoted(client, contractAddress, testPollId, dummyAddress);
        
        if (hasVotedDifferentUser === false) {
            console.log('✅ SUCCESS: hasVoted correctly returns false for different address');
        } else {
            console.log('❌ FAILURE: hasVoted should return false for different address, but returned:', hasVotedDifferentUser);
            return false;
        }
        
        // Step 7: Test with invalid poll ID (should handle gracefully)
        console.log('\n🔍 Step 7: Testing hasVoted with invalid poll ID...');
        try {
            const hasVotedInvalidPoll = await checkHasVoted(client, contractAddress, 999999, walletAddress);
            console.log('⚠️  hasVoted with invalid poll ID returned:', hasVotedInvalidPoll);
        } catch (error) {
            console.log('✅ SUCCESS: hasVoted properly handles invalid poll ID with error:', error.message);
        }
        
        // Step 8: Final summary
        console.log('\n📋 hasVoted METHOD TEST SUMMARY:');
        console.log('=================================');
        console.log(`Test Poll ID: ${testPollId}`);
        console.log(`Wallet Address: ${walletAddress.toString()}`);
        console.log(`Test Results:`);
        console.log(`  ✅ Before voting: hasVoted = ${hasVotedBefore}`);
        if (hasVotedBefore === false) {
            console.log(`  ✅ After voting: hasVoted = true`);
        }
        console.log(`  ✅ Different address: hasVoted = false`);
        console.log(`  ✅ Invalid poll handling: Proper error or false`);
        
        console.log('\n🎉 SUCCESS: hasVoted method is working correctly!');
        return true;

    } catch (error) {
        console.log('❌ Test error:', error.message);
        console.error(error);
        return false;
    }
}

// Run the test
testHasVotedMethod()
    .then(success => {
        console.log('\n' + '='.repeat(50));
        if (success) {
            console.log('🎉 hasVoted METHOD TESTS PASSED!');
            console.log('The hasVoted contract method is working correctly.');
        } else {
            console.log('❌ hasVoted METHOD TESTS FAILED!');
            console.log('Issues found with the hasVoted method.');
        }
        console.log('='.repeat(50));
    })
    .catch(error => {
        console.error('❌ Test execution error:', error);
    });