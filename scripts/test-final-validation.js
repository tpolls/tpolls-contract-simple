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

async function createPollWithValidation(client, wallet, keyPair, contractAddress, subject, options) {
    console.log('📝 Creating poll for validation...');
    console.log('Subject:', subject);
    console.log('Options:', options);
    
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

async function testFinalValidation() {
    console.log('🧪 Final Validation Test: Poll Options Storage');
    console.log('==============================================');

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
        // Test 1: Get current poll count (handle undefined exit_code)
        console.log('\n📊 Step 1: Getting current poll count...');
        const countResult = await client.runMethod(contractAddress, 'getPollCount');
        
        // Handle both exit_code formats
        const isSuccess = (countResult.exit_code === 0 || countResult.exit_code === undefined) && 
                         countResult.stack && countResult.stack.remaining > 0;
        
        if (isSuccess) {
            const currentCount = countResult.stack.readBigNumber();
            console.log('✅ Current poll count:', currentCount.toString());
            
            // Test 2: Create a new poll with specific test options
            const testOptions = [
                "Test Option A",
                "Test Option B", 
                "Test Option C"
            ];
            
            console.log('\n📝 Step 2: Creating test poll...');
            await createPollWithValidation(
                client, wallet, keyPair, contractAddress,
                "Final Validation Test Poll", 
                testOptions
            );
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 15000));
            
            // Test 3: Verify poll was created
            console.log('\n📊 Step 3: Verifying poll creation...');
            const newCountResult = await client.runMethod(contractAddress, 'getPollCount');
            const newCount = newCountResult.stack.readBigNumber();
            console.log('✅ New poll count:', newCount.toString());
            
            if (newCount > currentCount) {
                const pollId = newCount;
                console.log('✅ Poll created successfully! ID:', pollId.toString());
                
                // Test 4: Get poll subject to verify basic functionality
                console.log('\n📝 Step 4: Testing getPollSubject...');
                const subjectResult = await client.runMethod(contractAddress, 'getPollSubject', [
                    { type: 'int', value: pollId }
                ]);
                
                if (subjectResult.stack && subjectResult.stack.remaining > 0) {
                    const subject = subjectResult.stack.readString();
                    console.log('✅ Retrieved subject:', subject);
                    
                    // Test 5: Get poll options - the main test
                    console.log('\n🔍 Step 5: Testing getPollOptions (MAIN TEST)...');
                    const optionsResult = await client.runMethod(contractAddress, 'getPollOptions', [
                        { type: 'int', value: pollId }
                    ]);
                    
                    if (optionsResult.stack && optionsResult.stack.remaining > 0) {
                        const optionsCell = optionsResult.stack.readCellOpt();
                        
                        if (optionsCell) {
                            console.log('✅ Options cell retrieved successfully!');
                            
                            try {
                                const optionsDict = Dictionary.loadDirect(
                                    Dictionary.Keys.BigInt(257), 
                                    Dictionary.Values.Cell(),
                                    optionsCell
                                );
                                
                                console.log('✅ Options dictionary parsed!');
                                console.log('📊 Options count:', optionsDict.size);
                                
                                // Test 6: Validate each option value
                                console.log('\n🎯 Step 6: Validating option values...');
                                let allValid = true;
                                
                                for (let i = 0; i < testOptions.length; i++) {
                                    const storedCell = optionsDict.get(BigInt(i));
                                    if (storedCell) {
                                        const storedText = storedCell.beginParse().loadStringTail();
                                        const expected = testOptions[i];
                                        const matches = storedText === expected;
                                        
                                        console.log(`  Option ${i}:`);
                                        console.log(`    Expected: "${expected}"`);
                                        console.log(`    Stored:   "${storedText}"`);
                                        console.log(`    Valid:    ${matches ? '✅' : '❌'}`);
                                        
                                        if (!matches) allValid = false;
                                    } else {
                                        console.log(`  Option ${i}: ❌ NOT FOUND`);
                                        allValid = false;
                                    }
                                }
                                
                                // Final result
                                console.log('\n🎉 FINAL RESULT:');
                                if (allValid && optionsDict.size === testOptions.length) {
                                    console.log('✅ SUCCESS: Poll options are correctly stored and retrievable!');
                                    console.log('✅ All option values match exactly');
                                    console.log('✅ All expected options are present');
                                    return true;
                                } else {
                                    console.log('❌ FAILURE: Options validation failed');
                                    return false;
                                }
                                
                            } catch (parseError) {
                                console.log('❌ Error parsing options:', parseError.message);
                                return false;
                            }
                        } else {
                            console.log('❌ No options data in cell');
                            return false;
                        }
                    } else {
                        console.log('❌ getPollOptions returned no data');
                        return false;
                    }
                } else {
                    console.log('❌ getPollSubject failed');
                    return false;
                }
            } else {
                console.log('❌ Poll was not created');
                return false;
            }
        } else {
            console.log('❌ Failed to get poll count');
            return false;
        }

    } catch (error) {
        console.log('❌ Test error:', error.message);
        console.error(error);
        return false;
    }
}

// Run the test
testFinalValidation()
    .then(success => {
        console.log('\n' + '='.repeat(50));
        if (success) {
            console.log('🎉 ALL TESTS PASSED! Poll options storage is working correctly.');
        } else {
            console.log('❌ TESTS FAILED! There are issues with poll options storage.');
        }
        console.log('='.repeat(50));
    })
    .catch(error => {
        console.error('❌ Test execution error:', error);
    });