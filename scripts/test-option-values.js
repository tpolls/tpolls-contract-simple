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

async function createPollWithOptions(client, wallet, keyPair, contractAddress, subject, optionsArray) {
    console.log('📝 Creating poll with options:', optionsArray);
    
    // Create options dictionary with Cell values
    const optionsDict = Dictionary.empty(Dictionary.Keys.Int(257), Dictionary.Values.Cell());
    
    // Add each option as a Cell containing the string
    optionsArray.forEach((option, index) => {
        const optionCell = beginCell().storeStringTail(option).endCell();
        optionsDict.set(index, optionCell);
        console.log(`  Setting option ${index}: "${option}"`);
    });
    
    // CreatePoll message body
    const createPollBody = beginCell()
        .storeUint(1810031829, 32)  // CreatePoll opcode
        .storeStringRefTail(subject)  // Poll subject
        .storeDict(optionsDict)  // Options dictionary
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
    console.log('⏳ Waiting for poll creation...');
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
    
    if (currentSeqno === seqno) {
        throw new Error('Transaction timeout');
    }
    
    console.log('✅ Poll creation transaction completed');
    return true;
}

async function testOptionValues() {
    console.log('🧪 Testing Poll Option Values Storage and Retrieval');
    console.log('==================================================');

    // Load deployment info
    const deploymentPath = path.join(__dirname, '..', 'deployments', 'testnet-deployment.json');
    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const contractAddress = Address.parse(deploymentInfo.address.userFriendly);
    console.log('📍 Contract Address:', contractAddress.toString());

    // Set up client and wallet
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TESTNET_API_KEY
    });

    const { wallet, keyPair } = await loadWallet(client);

    try {
        // Get initial poll count
        const initialCountResult = await client.runMethod(contractAddress, 'getPollCount');
        const initialCount = initialCountResult.stack.readBigNumber();
        console.log('📊 Initial poll count:', initialCount.toString());

        // Create test poll with specific options
        const testSubject = "Testing Option Values Storage";
        const testOptions = [
            "First Option Text",
            "Second Option Text", 
            "Third Option Text",
            "Fourth Option Text"
        ];
        
        console.log('\n🎯 Creating test poll...');
        await createPollWithOptions(client, wallet, keyPair, contractAddress, testSubject, testOptions);
        
        // Wait for blockchain processing
        await new Promise(resolve => setTimeout(resolve, 15000));

        // Get new poll count
        const finalCountResult = await client.runMethod(contractAddress, 'getPollCount');
        const finalCount = finalCountResult.stack.readBigNumber();
        console.log('\n📊 Final poll count:', finalCount.toString());
        
        if (finalCount > initialCount) {
            const newPollId = finalCount;
            console.log('✅ Poll created successfully! Poll ID:', newPollId.toString());
            
            // Test retrieving and validating option values
            console.log('\n🔍 Retrieving and validating option values...');
            const optionsResult = await client.runMethod(contractAddress, 'getPollOptions', [
                { type: 'int', value: newPollId }
            ]);
            
            if (optionsResult.exit_code === 0 && optionsResult.stack.remaining > 0) {
                const optionsCell = optionsResult.stack.readCellOpt();
                if (optionsCell) {
                    try {
                        const optionsDict = Dictionary.loadDirect(
                            Dictionary.Keys.BigInt(257), 
                            Dictionary.Values.Cell(),
                            optionsCell
                        );
                        
                        console.log('📊 Retrieved options dictionary with', optionsDict.size, 'entries');
                        
                        let allOptionsMatch = true;
                        let retrievedOptions = [];
                        
                        // Check each option
                        for (let i = 0; i < testOptions.length; i++) {
                            const storedOptionCell = optionsDict.get(BigInt(i));
                            if (storedOptionCell) {
                                const retrievedText = storedOptionCell.beginParse().loadStringTail();
                                retrievedOptions.push(retrievedText);
                                
                                const expectedText = testOptions[i];
                                const matches = retrievedText === expectedText;
                                allOptionsMatch = allOptionsMatch && matches;
                                
                                console.log(`  Option ${i}:`);
                                console.log(`    Expected: "${expectedText}"`);
                                console.log(`    Retrieved: "${retrievedText}"`);
                                console.log(`    Match: ${matches ? '✅' : '❌'}`);
                            } else {
                                console.log(`  Option ${i}: ❌ NOT FOUND`);
                                allOptionsMatch = false;
                            }
                        }
                        
                        console.log('\n🎯 Final Validation Results:');
                        console.log('  📊 Expected options:', testOptions.length);
                        console.log('  📊 Retrieved options:', retrievedOptions.length);
                        console.log('  ✅ All options match:', allOptionsMatch ? 'YES' : 'NO');
                        
                        if (allOptionsMatch && retrievedOptions.length === testOptions.length) {
                            console.log('\n🎉 SUCCESS: All option values are correctly stored and retrieved!');
                            return true;
                        } else {
                            console.log('\n❌ FAILURE: Option values do not match or are incomplete');
                            return false;
                        }
                        
                    } catch (parseError) {
                        console.log('❌ Error parsing options dictionary:', parseError.message);
                        return false;
                    }
                } else {
                    console.log('❌ No options data returned from contract');
                    return false;
                }
            } else {
                console.log('❌ Failed to retrieve poll options, exit code:', optionsResult.exit_code);
                return false;
            }
        } else {
            console.log('❌ Poll creation failed - count did not increase');
            return false;
        }

    } catch (error) {
        console.log('❌ Error:', error.message);
        console.error(error);
        return false;
    }
}

// Run the test
if (require.main === module) {
    testOptionValues()
        .then(success => {
            if (success) {
                console.log('\n✅ All tests passed!');
                process.exit(0);
            } else {
                console.log('\n❌ Tests failed!');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('❌ Test error:', error);
            process.exit(1);
        });
}

module.exports = { testOptionValues };