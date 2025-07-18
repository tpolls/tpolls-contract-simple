const { Cell, beginCell, toNano, contractAddress } = require('@ton/core');
const { TonClient, WalletContractV4, internal } = require('@ton/ton');
const { mnemonicNew, mnemonicToPrivateKey } = require('@ton/crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function loadWallet(client) {
    let mnemonic;
    if (process.env.WALLET_MNEMONIC) {
        mnemonic = process.env.WALLET_MNEMONIC.split(' ');
    } else {
        console.log('🔑 Generating new wallet mnemonic...');
        mnemonic = await mnemonicNew();
        console.log('📝 Save this mnemonic phrase:');
        console.log(mnemonic.join(' '));
        console.log('⚠️  Add it to your .env file as WALLET_MNEMONIC');
    }
    const keyPair = await mnemonicToPrivateKey(mnemonic);
    const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    const walletContract = client.open(wallet);
    const walletAddress = wallet.address;
    console.log(`💼 Wallet address: ${walletAddress.toString()}`);
    const balance = await walletContract.getBalance();
    console.log(`💰 Wallet balance: ${Number(balance) / 1000000000} TON`);
    if (balance < toNano('0.5')) {
        console.log('⚠️  Wallet balance is low. Please fund your wallet before deployment.');
        process.exit(1);
    }
    return { wallet: walletContract, keyPair, address: walletAddress };
}

async function loadContractCode(contractName) {
    const buildPath = path.join(__dirname, '..', 'build');
    const codePath = path.join(buildPath, `${contractName}.code.boc`);
    if (!fs.existsSync(codePath)) {
        throw new Error(`Contract code not found: ${codePath}. Build the contract first.`);
    }
    return Cell.fromBoc(fs.readFileSync(codePath))[0];
}

async function sendTonToContract(client, wallet, keyPair, contractAddress, amount) {
    console.log(`💰 Sending ${amount} TON to contract for gas...`);
    
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
    let currentSeqno = seqno;
    let attempts = 0;
    while (currentSeqno === seqno && attempts < 15) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
            currentSeqno = await wallet.getSeqno();
        } catch (error) {
            // Continue waiting
        }
        attempts++;
    }
    
    console.log(`✅ Sent ${amount} TON to contract`);
}

async function deployContract(client, wallet, keyPair, contractName) {
    console.log('📦 Loading contract code...');
    const contractCode = await loadContractCode(contractName);
    
    // Use the exact same initialization pattern as Tact generates
    // Based on TPollsDapp_init function: store(0, 1) + storeAddress(owner)
    const initialData = beginCell()
        .storeUint(0, 1)  // Required first bit for Tact contracts
        .storeAddress(wallet.address)  // owner parameter
        .endCell();
    
    const stateInit = { code: contractCode, data: initialData };
    const deployAddress = contractAddress(0, stateInit);
    console.log(`📍 Contract will be deployed to: ${deployAddress.toString()}`);
    
    const contractState = await client.getContractState(deployAddress);
    if (contractState.state === 'active') {
        console.log('✅ Contract is already deployed and active');
        // Still send some TON for gas if balance is low
        const balance = contractState.balance;
        if (balance < toNano('0.1')) {
            console.log('💰 Sending additional TON for gas...');
            await sendTonToContract(client, wallet, keyPair, deployAddress, '0.1');
        }
        return deployAddress;
    }
    
    console.log('🚀 Deploying contract with initialization...');
    
    // Deploy with proper Deploy message and more TON
    const deployBody = beginCell()
        .storeUint(2490013878, 32)  // Deploy opcode
        .storeUint(0, 64)  // queryId
        .endCell();
    
    const deployMessage = internal({
        to: deployAddress,
        value: toNano('0.2'), // More TON for deployment
        init: stateInit,
        body: deployBody,
    });
    
    const seqno = await wallet.getSeqno();
    await wallet.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [deployMessage],
    });
    console.log('⏳ Waiting for deployment confirmation...');
    let currentSeqno = seqno;
    let attempts = 0;
    while (currentSeqno === seqno && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
            currentSeqno = await wallet.getSeqno();
        } catch (error) {
            if (error.response?.status === 429) {
                console.log('⏳ Rate limited, waiting longer...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        attempts++;
    }
    if (attempts >= 30) {
        console.log('⚠️  Deployment timeout reached, but continuing...');
    }
    try {
        const finalState = await client.getContractState(deployAddress);
        console.log(`📊 Contract state: ${finalState.state}`);
        console.log(`💰 Contract balance: ${Number(finalState.balance) / 1000000000} TON`);
        
        if (finalState.state === 'active') {
            console.log('✅ Contract deployed successfully!');
            
            // Send additional TON for operations if balance is low
            if (finalState.balance < toNano('0.1')) {
                console.log('💰 Contract balance is low, sending additional TON...');
                await sendTonToContract(client, wallet, keyPair, deployAddress, '0.1');
                
                // Check final balance
                const updatedState = await client.getContractState(deployAddress);
                console.log(`💰 Updated contract balance: ${Number(updatedState.balance) / 1000000000} TON`);
            }
            
            return deployAddress;
        } else if (finalState.state === 'uninitialized') {
            console.log('⚠️  Contract deployed but not initialized yet');
            
            // Send some TON anyway for future operations
            await sendTonToContract(client, wallet, keyPair, deployAddress, '0.1');
            
            return deployAddress;
        } else {
            console.log(`❌ Unexpected contract state: ${finalState.state}`);
            throw new Error(`❌ Contract deployment failed - state: ${finalState.state}`);
        }
    } catch (error) {
        console.log(`❌ Error checking contract state: ${error.message}`);
        throw error;
    }
}

async function saveDeploymentInfo(contractAddress, isTestnet, wallet) {
    const deploymentInfo = {
        network: isTestnet ? 'testnet' : 'mainnet',
        contractName: 'TPollsDapp',
        address: {
            raw: contractAddress.toRawString(),
            userFriendly: contractAddress.toString()
        },
        deployer: wallet.address.toString(),
        deployedAt: new Date().toISOString()
    };
    
    const deploymentPath = path.join(__dirname, '..', 'deployments');
    if (!fs.existsSync(deploymentPath)) {
        fs.mkdirSync(deploymentPath, { recursive: true });
    }
    
    const fileName = `${isTestnet ? 'testnet' : 'mainnet'}-deployment.json`;
    const outputPath = path.join(deploymentPath, fileName);
    fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`📄 Deployment info saved to: ${outputPath}`);
}

async function main() {
    const isTestnet = process.argv.includes('--testnet');
    const endpoint = isTestnet
        ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
        : 'https://toncenter.com/api/v2/jsonRPC';
    const apiKey = isTestnet ? process.env.TESTNET_API_KEY : process.env.MAINNET_API_KEY;
    const client = new TonClient({ endpoint, apiKey });
    console.log(`🌐 Deploying to ${isTestnet ? 'testnet' : 'mainnet'}...`);
    try {
        const { wallet, keyPair } = await loadWallet(client);
        const contractName = 'TPollsDapp_TPollsDapp'; // Matches the build output
        const contractAddress = await deployContract(client, wallet, keyPair, contractName);
        await saveDeploymentInfo(contractAddress, isTestnet, wallet);
        console.log('🎉 Deployment completed successfully!');
        console.log(`📍 Contract Address: ${contractAddress.toString()}`);
        console.log(`🌐 Network: ${isTestnet ? 'testnet' : 'mainnet'}`);
    } catch (error) {
        console.error('❌ Deployment failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}