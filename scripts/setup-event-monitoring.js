#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔧 Setting up TON Event Monitoring');
console.log('==================================');

// Check if MongoDB is available
async function checkMongoDB() {
    try {
        const { MongoClient } = require('mongodb');
        const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017';
        const client = new MongoClient(mongoUrl);
        await client.connect();
        await client.close();
        console.log('✅ MongoDB connection successful');
        return true;
    } catch (error) {
        console.log('❌ MongoDB not available:', error.message);
        console.log('💡 Install MongoDB or provide MONGODB_URL in .env');
        return false;
    }
}

// Create package.json scripts
function updatePackageScripts() {
    const packagePath = path.join(__dirname, '..', 'package.json');
    
    try {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        
        // Add event monitoring scripts
        packageJson.scripts = {
            ...packageJson.scripts,
            'events:listen': 'node scripts/event-listener.js',
            'events:websocket': 'node scripts/websocket-listener.js',
            'events:index': 'node scripts/vote-indexer.js',
            'events:setup': 'node scripts/setup-event-monitoring.js'
        };

        fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
        console.log('✅ Updated package.json scripts');
        
    } catch (error) {
        console.log('⚠️  Could not update package.json:', error.message);
    }
}

// Create environment variables template
function createEnvTemplate() {
    const envPath = path.join(__dirname, '..', '.env.example');
    
    const envTemplate = `
# TON Configuration
TESTNET_API_KEY=your_toncenter_api_key_here
CONTRACT_ADDRESS=your_contract_address_here
WALLET_MNEMONIC="your wallet mnemonic words here"

# MongoDB Configuration (optional)
MONGODB_URL=mongodb://localhost:27017

# API Server Configuration
PORT=3001

# TON Network
TON_NETWORK=testnet
VITE_TON_NETWORK=testnet
VITE_TONCENTER_ENDPOINT=https://testnet.toncenter.com/api/v2/jsonRPC
VITE_TONCENTER_API_KEY=your_toncenter_api_key_here
VITE_SIMPLE_CONTRACT_ADDRESS=your_contract_address_here
`;

    fs.writeFileSync(envPath, envTemplate.trim());
    console.log('✅ Created .env.example template');
}

// Check dependencies
function checkDependencies() {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    
    const requiredDeps = {
        'ws': '^8.0.0',
        'mongodb': '^6.0.0',
        'express': '^4.18.0'
    };

    const missing = [];
    for (const [dep, version] of Object.entries(requiredDeps)) {
        if (!packageJson.dependencies?.[dep] && !packageJson.devDependencies?.[dep]) {
            missing.push(`${dep}@${version}`);
        }
    }

    if (missing.length > 0) {
        console.log('📦 Missing dependencies:');
        console.log('   npm install', missing.join(' '));
        return false;
    } else {
        console.log('✅ All dependencies available');
        return true;
    }
}

// Main setup function
async function setup() {
    console.log('\n1. Checking dependencies...');
    const hasDeps = checkDependencies();
    
    console.log('\n2. Checking MongoDB...');
    const hasMongoDB = await checkMongoDB();
    
    console.log('\n3. Updating package.json...');
    updatePackageScripts();
    
    console.log('\n4. Creating environment template...');
    createEnvTemplate();
    
    console.log('\n📋 Next Steps:');
    console.log('==============');
    
    if (!hasDeps) {
        console.log('1. Install missing dependencies:');
        console.log('   npm install ws mongodb express');
    }
    
    console.log('2. Configure your .env file:');
    console.log('   cp .env.example .env');
    console.log('   # Edit .env with your values');
    
    if (!hasMongoDB) {
        console.log('3. Setup MongoDB (optional):');
        console.log('   # Local: brew install mongodb-community (macOS)');
        console.log('   # Cloud: Use MongoDB Atlas');
        console.log('   # Docker: docker run -d -p 27017:27017 mongo');
    }
    
    console.log('4. Deploy your updated contract:');
    console.log('   npm run deploy:testnet');
    
    console.log('5. Start event monitoring:');
    console.log('   npm run events:listen    # Basic polling');
    console.log('   npm run events:websocket # WebSocket (if available)');
    console.log('   npm run events:index     # Full indexer with API');
    
    console.log('\n🔗 Available Endpoints (when using indexer):');
    console.log('==========================================');
    console.log('GET  /api/polls/:pollId/votes     - Get votes for poll');
    console.log('GET  /api/voters/:address/votes   - Get votes by voter');
    console.log('GET  /api/voters/:address/rewards - Get unclaimed rewards');
    console.log('GET  /api/polls/:pollId/stats     - Get poll statistics');
    console.log('POST /api/rewards/claim           - Mark reward as claimed');
    
    console.log('\n🎉 Setup complete!');
}

setup().catch(console.error);