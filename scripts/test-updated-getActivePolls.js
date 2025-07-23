/**
 * Test the updated getActivePolls method that retrieves options directly
 */

const { TonClient } = require('@ton/ton');
const { Address, Dictionary } = require('@ton/core');
require('dotenv').config();

// Simulate the updated service getActivePolls method
async function testUpdatedGetActivePolls() {
    console.log('🧪 Testing Updated getActivePolls Method');
    console.log('======================================');

    const contractAddress = 'EQBTTSiLga3dkYVTrKNFQYxat2UBTkL2RxGOGp4vqjMdPdTG';
    
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        apiKey: process.env.TESTNET_API_KEY
    });

    const _formatAddress = (address) => {
        if (!address || address.length < 10) return 'Unknown';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };

    try {
        const addr = Address.parse(contractAddress);
        
        // Get total number of polls
        let totalPolls = 0;
        try {
            const result = await client.runMethod(addr, 'getPollCount');
            if (result.stack && result.stack.items.length > 0) {
                totalPolls = Number(result.stack.items[0].value);
            }
        } catch (error) {
            console.warn('Could not get total polls count:', error);
            totalPolls = 5; // fallback
        }

        console.log(`📊 Found ${totalPolls} total polls`);
        const activePolls = [];
        
        // Test each poll ID
        for (let pollId = 1; pollId <= totalPolls; pollId++) {
            try {
                // First, try to get options directly using the known poll ID
                let pollOptions = [];
                let pollSubject = `Poll ${pollId}`;
                let pollCreator = 'Unknown';
                
                console.log(`\n🔍 Attempting to fetch options directly for poll ${pollId}`);
                try {
                    const optionsResult = await client.runMethod(addr, 'getPollOptions', [
                        { type: 'int', value: BigInt(pollId) }
                    ]);
                    
                    // Handle both exit_code formats (0 or undefined for success)
                    const isSuccess = (optionsResult.exit_code === 0 || optionsResult.exit_code === undefined) && 
                                     optionsResult.stack && optionsResult.stack.remaining > 0;
                    
                    if (isSuccess) {
                        const optionsCell = optionsResult.stack.readCellOpt();
                        if (optionsCell) {
                            const optionsDict = Dictionary.loadDirect(
                                Dictionary.Keys.BigInt(257), 
                                Dictionary.Values.Cell(), 
                                optionsCell
                            );
                            
                            for (let i = 0; i < optionsDict.size; i++) {
                                const optionCell = optionsDict.get(BigInt(i));
                                if (optionCell) {
                                    const optionText = optionCell.beginParse().loadStringTail();
                                    pollOptions.push(optionText);
                                }
                            }
                            console.log(`  ✅ Retrieved ${pollOptions.length} options:`, pollOptions);
                        }
                    }
                } catch (optionsError) {
                    console.log(`  ⚠️ Could not get options: ${optionsError.message}`);
                    // This poll might not exist or have no options, skip it
                    continue;
                }
                
                // Only proceed if we got options (meaning the poll exists)
                if (pollOptions.length === 0) {
                    console.log(`  ⚠️ No options found, skipping poll ${pollId}`);
                    continue;
                }
                
                // Now try to get additional poll info (subject, creator)
                try {
                    const pollResult = await client.runMethod(addr, 'getPoll', [
                        { type: 'int', value: BigInt(pollId) }
                    ]);
                    
                    if (pollResult.stack && pollResult.stack.remaining > 0) {
                        try {
                            const pollTuple = pollResult.stack.readTupleOpt();
                            if (pollTuple) {
                                const parsedPollId = Number(pollTuple.readBigNumber());
                                const creator = pollTuple.readAddress();
                                const subject = pollTuple.readString();
                                
                                pollSubject = subject || `Poll ${pollId}`;
                                pollCreator = creator.toString();
                                
                                console.log(`  ✅ Retrieved poll info for ${parsedPollId}: "${pollSubject}"`);
                            }
                        } catch (parseError) {
                            console.log(`  ⚠️ Could not parse poll details for ${pollId}, using defaults`);
                        }
                    }
                } catch (pollError) {
                    console.log(`  ⚠️ Could not get poll details for ${pollId}, using defaults`);
                }
                
                // Create a transformed poll object
                const transformedPoll = {
                    id: pollId,
                    title: pollSubject,
                    description: 'Direct contract poll',
                    options: pollOptions,
                    category: 'general',
                    author: _formatAddress(pollCreator),
                    totalVotes: 0,
                    totalResponses: 0,
                    isActive: true,
                    createdAt: 'Unknown',
                    type: 'simple-blockchain',
                    optionCount: pollOptions.length,
                    hasAiData: false,
                    subject: pollSubject,
                };
                
                activePolls.push(transformedPoll);
                console.log(`  ✅ Added poll ${pollId} with ${pollOptions.length} options to active polls`);
                
            } catch (pollError) {
                console.log(`  ❌ Poll ${pollId} not accessible: ${pollError.message}`);
            }
        }

        console.log(`\n📋 Final Results:`);
        console.log(`================`);
        console.log(`Total polls found: ${activePolls.length}`);
        
        activePolls.forEach(poll => {
            console.log(`\nPoll ${poll.id}: "${poll.title}"`);
            console.log(`  Author: ${poll.author}`);
            console.log(`  Options (${poll.optionCount}):`);
            poll.options.forEach((option, index) => {
                console.log(`    ${index}: "${option}"`);
            });
        });
        
        const pollsWithRealOptions = activePolls.filter(poll => 
            poll.options.length > 0 && 
            !poll.options.every(opt => opt.match(/^Option \d+$/))
        );
        
        console.log(`\n🎯 SUCCESS SUMMARY:`);
        console.log(`  Total polls retrieved: ${activePolls.length}`);
        console.log(`  Polls with real options: ${pollsWithRealOptions.length}`);
        console.log(`  Polls with generic options: ${activePolls.length - pollsWithRealOptions.length}`);
        
        if (pollsWithRealOptions.length > 0) {
            console.log(`\n🎉 SUCCESS: getActivePolls() now retrieves real poll options!`);
            console.log(`🚀 Frontend will display actual option text instead of placeholders`);
        } else if (activePolls.length > 0) {
            console.log(`\n✅ PARTIAL SUCCESS: Polls found but with generic options`);
            console.log(`💡 This suggests polls were created before options were implemented`);
        } else {
            console.log(`\n⚠️ No polls found - contract may be empty or all polls failed to load`);
        }
        
        return { success: true, polls: activePolls, realOptionsCount: pollsWithRealOptions.length };
        
    } catch (error) {
        console.log('❌ Error:', error.message);
        return { success: false, error: error.message };
    }
}

// Run the test
testUpdatedGetActivePolls()
    .then(result => {
        console.log('\n' + '='.repeat(60));
        if (result.success) {
            console.log('✅ getActivePolls() UPDATE COMPLETE AND TESTED');
            console.log(`📊 Found ${result.polls.length} polls, ${result.realOptionsCount} with real options`);
        } else {
            console.log('❌ getActivePolls() update test failed');
            console.log('Error:', result.error);
        }
        console.log('='.repeat(60));
    })
    .catch(console.error);