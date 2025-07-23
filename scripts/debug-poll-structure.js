const { TonClient } = require('@ton/ton');
const { Address } = require('@ton/core');
require('dotenv').config();

async function debugPollStructure() {
    console.log('🔍 Debugging Actual Poll Structure');
    console.log('==================================');

    const contractAddress = 'EQBTTSiLga3dkYVTrKNFQYxat2UBTkL2RxGOGp4vqjMdPdTG';
    
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TESTNET_API_KEY
    });

    try {
        const addr = Address.parse(contractAddress);
        
        // Test getPoll for poll 4 (we know it exists)
        console.log('\n📊 Getting poll 4 structure...');
        const pollResult = await client.runMethod(addr, 'getPoll', [
            { type: 'int', value: 4n }
        ]);
        
        console.log('Poll result raw:', {
            exit_code: pollResult.exit_code,
            stack_remaining: pollResult.stack ? pollResult.stack.remaining : 'no stack',
            stack_items: pollResult.stack ? pollResult.stack.items.length : 'no items'
        });
        
        if (pollResult.stack && pollResult.stack.items.length > 0) {
            console.log('\n📋 Stack items detailed inspection:');
            
            const item = pollResult.stack.items[0];
            console.log('First item type:', item.type);
            
            if (item.type === 'tuple') {
                console.log('Tuple items count:', item.items.length);
                
                item.items.forEach((subItem, index) => {
                    console.log(`  Item ${index}:`, {
                        type: subItem.type,
                        hasValue: !!subItem.value,
                        value: subItem.value ? String(subItem.value).slice(0, 50) : 'no value',
                        hasCell: !!subItem.cell,
                        hasAddress: !!subItem.address
                    });
                });
                
                // Try to manually parse each field
                console.log('\n🔍 Manual parsing attempt:');
                
                try {
                    // Poll ID (should be BigInt)
                    const pollId = item.items[0]?.value ? Number(item.items[0].value) : 0;
                    console.log('  Poll ID:', pollId);
                    
                    // Creator address
                    if (item.items[1]) {
                        try {
                            let creator = 'Unknown';
                            if (item.items[1].type === 'slice') {
                                const slice = item.items[1];
                                const address = slice.loadAddress();
                                creator = address.toString();
                            } else if (item.items[1].address) {
                                creator = item.items[1].address.toString();
                            }
                            console.log('  Creator:', creator.slice(0, 20) + '...');
                        } catch (e) {
                            console.log('  Creator parsing failed:', e.message);
                        }
                    }
                    
                    // Subject string
                    if (item.items[2]) {
                        try {
                            let subject = 'No subject';
                            if (item.items[2].type === 'slice') {
                                const slice = item.items[2];
                                subject = slice.loadStringTail();
                            } else if (item.items[2].value) {
                                subject = String(item.items[2].value);
                            }
                            console.log('  Subject:', subject);
                        } catch (e) {
                            console.log('  Subject parsing failed:', e.message);
                        }
                    }
                    
                    // Now let's try the safer approach using the stack reader
                    console.log('\n🔄 Using stack reader approach:');
                    
                    // Reset and read properly
                    const pollResult2 = await client.runMethod(addr, 'getPoll', [
                        { type: 'int', value: 4n }
                    ]);
                    
                    if (pollResult2.stack && pollResult2.stack.remaining > 0) {
                        const pollTuple = pollResult2.stack.readTupleOpt();
                        if (pollTuple) {
                            const pollId = pollTuple.readBigNumber();
                            const creator = pollTuple.readAddress();
                            const subject = pollTuple.readString();
                            
                            console.log('  ✅ Poll ID (stack reader):', pollId.toString());
                            console.log('  ✅ Creator (stack reader):', creator.toString().slice(0, 20) + '...');
                            console.log('  ✅ Subject (stack reader):', subject);
                            
                            // Try to read options
                            if (pollTuple.remaining > 0) {
                                const optionsCell = pollTuple.readCellOpt();
                                console.log('  📊 Options cell available:', !!optionsCell);
                                
                                if (optionsCell) {
                                    console.log('\n🎯 Testing options parsing...');
                                    // This should work since we proved getPollOptions works
                                    const optionsResult = await client.runMethod(addr, 'getPollOptions', [
                                        { type: 'int', value: BigInt(pollId) }
                                    ]);
                                    
                                    if (optionsResult.stack && optionsResult.stack.remaining > 0) {
                                        console.log('  ✅ getPollOptions confirms options exist');
                                    }
                                }
                            }
                        }
                    }
                    
                } catch (parseError) {
                    console.log('❌ Manual parsing error:', parseError.message);
                }
            }
        }
        
    } catch (error) {
        console.log('❌ Error:', error.message);
    }
}

debugPollStructure().catch(console.error);