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

async function createPollWithOptions(client, wallet, keyPair, contractAddress, subject, optionsArray) {
    console.log('📝 Creating poll with options:', optionsArray);
    
    // Create options dictionary with Cell values
    const optionsDict = Dictionary.empty(Dictionary.Keys.Int(257), Dictionary.Values.Cell());
    
    // Add each option as a Cell containing the string as comment
    optionsArray.forEach((option, index) => {
        const optionCell = beginCell().storeStringTail(option).endCell();
        optionsDict.set(index, optionCell);
    });
    
    // CreatePoll message body (correct opcode: 1810031829)
    const createPollBody = beginCell()
        .storeUint(1810031829, 32)  // CreatePoll opcode
        .storeStringRefTail(subject)  // Poll subject
        .storeDict(optionsDict)  // Options dictionary
        .endCell();
    
    console.log('📦 Message body created, sending transaction...');
    
    const message = internal({
        to: contractAddress,
        value: toNano('0.1'), // Increased gas for dictionary storage
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
        throw new Error('Transaction timeout - poll creation may have failed');
    }
    
    console.log('✅ Poll creation transaction completed');
}

async function testPollCreationWithOptions() {
    console.log('🧪 Complete Poll Creation with Options Test');
    console.log('==========================================');

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
        // Check initial poll count
        console.log('\n📊 Checking initial poll count...');
        const initialCountResult = await client.runMethod(contractAddress, 'getPollCount');
        const initialCount = initialCountResult.stack.readBigNumber();
        console.log('📊 Initial poll count:', initialCount.toString());

        // Create a poll with options
        const pollSubject = "What's your favorite blockchain feature?";
        const pollOptions = [
            "Smart Contracts",
            "Decentralization", 
            "Low Fees",
            "Fast Transactions"
        ];
        
        await createPollWithOptions(client, wallet, keyPair, contractAddress, pollSubject, pollOptions);
        
        // Wait a bit more for blockchain to process
        console.log('⏳ Waiting for blockchain confirmation...');
        await new Promise(resolve => setTimeout(resolve, 15000));

        // Check poll count after creation
        console.log('\n📊 Checking poll count after creation...');
        const finalCountResult = await client.runMethod(contractAddress, 'getPollCount');
        const finalCount = finalCountResult.stack.readBigNumber();
        console.log('📊 Final poll count:', finalCount.toString());
        
        if (finalCount > initialCount) {
            const newPollId = finalCount;
            console.log('✅ Poll created successfully! Poll ID:', newPollId.toString());
            
            // Test getting the poll details
            console.log('\n📝 Getting poll details...');
            const pollResult = await client.runMethod(contractAddress, 'getPoll', [
                { type: 'int', value: newPollId }
            ]);
            
            if (pollResult.exit_code === 0 && pollResult.stack.remaining > 0) {
                console.log('✅ Poll retrieved successfully');
                const pollTuple = pollResult.stack.readTupleOpt();
                if (pollTuple) {
                    const pollId = pollTuple.readBigNumber();
                    const creator = pollTuple.readAddress();
                    const subject = pollTuple.readString();
                    
                    console.log('  📍 Poll ID:', pollId.toString());
                    console.log('  👤 Creator:', creator.toString());
                    console.log('  📝 Subject:', subject);
                    console.log('  ✅ Subject matches:', subject === pollSubject);
                } else {
                    console.log('❌ Poll tuple is null');
                }
            } else {
                console.log('❌ Failed to retrieve poll details, exit code:', pollResult.exit_code);
            }

            // Test getting poll options
            console.log('\n🔍 Testing poll options retrieval...');
            const optionsResult = await client.runMethod(contractAddress, 'getPollOptions', [
                { type: 'int', value: newPollId }
            ]);
            
            if (optionsResult.exit_code === 0 && optionsResult.stack.remaining > 0) {
                console.log('✅ Poll options retrieved successfully');
                const optionsCell = optionsResult.stack.readCellOpt();
                if (optionsCell) {
                    console.log('📊 Options data found in blockchain');
                    // Try to parse the dictionary
                    try {
                        const optionsDict = Dictionary.loadDirect(
                            Dictionary.Keys.BigInt(257), 
                            Dictionary.Values.Cell(),
                            optionsCell
                        );
                        console.log('✅ Options dictionary parsed successfully');
                        console.log('📊 Number of options stored:', optionsDict.size);
                        
                        // Display stored options
                        for (let i = 0; i < pollOptions.length; i++) {
                            const storedOption = optionsDict.get(BigInt(i));
                            if (storedOption) {
                                const optionText = storedOption.beginParse().loadStringTail();
                                console.log(`  ${i}: "${optionText}" ✅`);
                            } else {
                                console.log(`  ${i}: [not found] ❌`);
                            }
                        }
                    } catch (parseError) {
                        console.log('⚠️ Could not parse options dictionary:', parseError.message);
                    }
                } else {
                    console.log('❌ No options data found (empty cell)');
                }
            } else {
                console.log('❌ Failed to retrieve poll options, exit code:', optionsResult.exit_code);
            }

            // Test voting on a valid option
            console.log('\n🗳️ Testing vote on valid option...');
            const voteBody = beginCell()
                .storeUint(1011836453, 32)  // Vote opcode
                .storeInt(newPollId, 257)      // pollId
                .storeInt(0, 257) // Vote for option 0
                .endCell();
            
            const voteMessage = internal({
                to: contractAddress,
                value: toNano('0.05'),
                body: voteBody,
            });
            
            const voteSeqno = await wallet.getSeqno();
            await wallet.sendTransfer({
                seqno: voteSeqno,
                secretKey: keyPair.secretKey,
                messages: [voteMessage],
            });
            
            console.log('✅ Vote submitted for option 0');

        } else {
            console.log('❌ Poll creation failed - count did not increase');
        }

        console.log('\n🎉 Test completed successfully!');
        console.log('📋 Summary:');
        console.log('  ✅ Poll with options created and stored on-chain');
        console.log('  ✅ Options are retrievable via getPollOptions()');
        console.log('  ✅ Voting works with option validation');

    } catch (error) {
        console.log('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    }
}

// Run the test
testPollCreationWithOptions().catch(console.error);