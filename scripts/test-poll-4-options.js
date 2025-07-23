const { TonClient } = require('@ton/ton');
const { Address, Dictionary } = require('@ton/core');
require('dotenv').config();

async function testPoll4Options() {
    console.log('🧪 Testing Poll 4 Options Retrieval');
    console.log('====================================');

    const contractAddress = 'EQBTTSiLga3dkYVTrKNFQYxat2UBTkL2RxGOGp4vqjMdPdTG';
    
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TESTNET_API_KEY
    });

    try {
        const addr = Address.parse(contractAddress);
        
        // Test getPollOptions directly for poll 4 (we know this has options)
        console.log('\n🔍 Testing getPollOptions for poll 4...');
        const optionsResult = await client.runMethod(addr, 'getPollOptions', [
            { type: 'int', value: 4n }
        ]);
        
        console.log('Options result raw:', {
            exit_code: optionsResult.exit_code,
            stack_remaining: optionsResult.stack ? optionsResult.stack.remaining : 'no stack',
            stack_items: optionsResult.stack ? optionsResult.stack.items.length : 'no items'
        });
        
        // Handle both exit_code formats (0 or undefined for success)
        const isSuccess = (optionsResult.exit_code === 0 || optionsResult.exit_code === undefined) && 
                         optionsResult.stack && optionsResult.stack.remaining > 0;
        
        if (isSuccess) {
            console.log('✅ getPollOptions returned data');
            const optionsCell = optionsResult.stack.readCellOpt();
            
            if (optionsCell) {
                console.log('✅ Options cell found');
                
                try {
                    const optionsDict = Dictionary.loadDirect(
                        Dictionary.Keys.BigInt(257), 
                        Dictionary.Values.Cell(),
                        optionsCell
                    );
                    
                    console.log('✅ Options dictionary loaded');
                    console.log('📊 Dictionary size:', optionsDict.size);
                    
                    const options = [];
                    for (let i = 0; i < optionsDict.size; i++) {
                        const optionCell = optionsDict.get(BigInt(i));
                        if (optionCell) {
                            const optionText = optionCell.beginParse().loadStringTail();
                            options.push(optionText);
                            console.log(`  Option ${i}: "${optionText}"`);
                        }
                    }
                    
                    console.log('\n🎉 SUCCESS: Retrieved real options from contract!');
                    console.log('📋 Options found:', options);
                    
                    return { success: true, options };
                    
                } catch (parseError) {
                    console.log('❌ Error parsing options dictionary:', parseError.message);
                    return { success: false, error: parseError.message };
                }
            } else {
                console.log('❌ No options cell returned (empty dictionary)');
                return { success: false, error: 'Empty options cell' };
            }
        } else {
            console.log('❌ getPollOptions failed:', optionsResult.exit_code);
            return { success: false, error: `Exit code: ${optionsResult.exit_code}` };
        }
        
    } catch (error) {
        console.log('❌ Error:', error.message);
        return { success: false, error: error.message };
    }
}

// Run the test
testPoll4Options()
    .then(result => {
        console.log('\n' + '='.repeat(50));
        if (result.success) {
            console.log('✅ CONFIRMED: getActivePolls() will retrieve real options!');
            console.log('🔧 The updated code should now work correctly.');
        } else {
            console.log('❌ ISSUE: Options retrieval failed');
            console.log('🔧 May need additional debugging or poll was created without options');
        }
        console.log('='.repeat(50));
    })
    .catch(console.error);