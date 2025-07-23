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

async function createPoll(client, wallet, keyPair, contractAddress, subject, options) {
    console.log('📝 Creating poll...');
    console.log('Subject:', subject);
    
    // Create options dictionary
    const optionsDict = Dictionary.empty(Dictionary.Keys.Int(257), Dictionary.Values.Cell());
    options.forEach((option, index) => {
        const optionCell = beginCell().storeStringTail(option).endCell();
        optionsDict.set(index, optionCell);
    });
    
    // Create message
    const createPollBody = beginCell()
        .storeUint(1810031829, 32)  // CreatePoll opcode
        .storeStringRefTail(subject)
        .storeDict(optionsDict)
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

async function testSubjectValidation() {
    console.log('🧪 Subject Validation Test');
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

    const { wallet, keyPair } = await loadWallet(client);

    try {
        // Test data
        const testSubject = "Which programming language is best for blockchain development?";
        const testOptions = [
            "Solidity",
            "Rust", 
            "JavaScript",
            "Python"
        ];

        // Step 1: Get current poll count
        console.log('\n📊 Step 1: Getting current poll count...');
        const countResult = await client.runMethod(contractAddress, 'getPollCount');
        
        const isSuccess = (countResult.exit_code === 0 || countResult.exit_code === undefined) && 
                         countResult.stack && countResult.stack.remaining > 0;
        
        if (!isSuccess) {
            throw new Error('Failed to get poll count');
        }

        const currentCount = countResult.stack.readBigNumber();
        console.log('✅ Current poll count:', currentCount.toString());
        
        // Step 2: Create poll with test subject
        console.log('\n📝 Step 2: Creating poll with test subject...');
        await createPoll(client, wallet, keyPair, contractAddress, testSubject, testOptions);
        
        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Step 3: Verify poll was created
        console.log('\n📊 Step 3: Verifying poll creation...');
        const newCountResult = await client.runMethod(contractAddress, 'getPollCount');
        const newCount = newCountResult.stack.readBigNumber();
        console.log('✅ New poll count:', newCount.toString());
        
        if (newCount <= currentCount) {
            throw new Error('Poll was not created');
        }

        const pollId = newCount;
        console.log('✅ Poll created successfully! ID:', pollId.toString());
        
        // Step 4: Test subject retrieval using getPollSubject
        console.log('\n📝 Step 4: Testing subject retrieval with getPollSubject...');
        const subjectResult = await client.runMethod(contractAddress, 'getPollSubject', [
            { type: 'int', value: pollId }
        ]);
        
        if (!subjectResult.stack || subjectResult.stack.remaining === 0) {
            throw new Error('getPollSubject returned no data');
        }

        const subjectFromDedicated = subjectResult.stack.readString();
        
        // Step 5: Test subject retrieval using getPoll (frontend method)
        console.log('\n📝 Step 5: Testing subject retrieval with getPoll (frontend method)...');
        const pollResult = await client.runMethod(contractAddress, 'getPoll', [
            { type: 'int', value: pollId }
        ]);
        
        if (!pollResult.stack || pollResult.stack.remaining === 0) {
            throw new Error('getPoll returned no data');
        }

        // Parse the Poll struct returned by getPoll
        const pollTuple = pollResult.stack.readTuple();
        if (!pollTuple || !pollTuple.items) {
            throw new Error('getPoll returned invalid tuple');
        }

        // Parse the Poll struct: [pollId, creator, subject, options, results]
        // Extract subject (position 2 in the tuple)
        let subjectFromPoll = 'No subject';
        try {
            if (pollTuple.items[2]?.type === 'cell') {
                const subjectSlice = pollTuple.items[2].cell.beginParse();
                subjectFromPoll = subjectSlice.loadStringTail();
            } else {
                const subjectSlice = pollTuple.items[2].beginParse();
                subjectFromPoll = subjectSlice.loadStringTail();
            }
        } catch (e) {
            console.warn('Failed to parse subject from getPoll:', e.message);
        }
        
        console.log('\n🔍 Subject Comparison:');
        console.log('  Submitted:           ', `"${testSubject}"`);
        console.log('  getPollSubject():    ', `"${subjectFromDedicated}"`);
        console.log('  getPoll().subject:   ', `"${subjectFromPoll}"`);
        console.log('  Submitted vs Dedicated:', testSubject === subjectFromDedicated ? '✅' : '❌');
        console.log('  Submitted vs Poll:     ', testSubject === subjectFromPoll ? '✅' : '❌');
        console.log('  Dedicated vs Poll:     ', subjectFromDedicated === subjectFromPoll ? '✅' : '❌');
        
        // Final validation
        const allMatch = testSubject === subjectFromDedicated && 
                        testSubject === subjectFromPoll && 
                        subjectFromDedicated === subjectFromPoll;
                        
        if (allMatch) {
            console.log('\n🎉 SUCCESS: Both methods return the same subject and match the submitted value!');
            return true;
        } else {
            console.log('\n❌ FAILURE: Subject mismatch detected between methods!');
            return false;
        }

    } catch (error) {
        console.log('❌ Test error:', error.message);
        console.error(error);
        return false;
    }
}

// Run the test
testSubjectValidation()
    .then(success => {
        console.log('\n' + '='.repeat(50));
        if (success) {
            console.log('🎉 SUBJECT TEST PASSED! Poll subject storage is working correctly.');
        } else {
            console.log('❌ SUBJECT TEST FAILED! There are issues with subject storage.');
        }
        console.log('='.repeat(50));
    })
    .catch(error => {
        console.error('❌ Test execution error:', error);
    });