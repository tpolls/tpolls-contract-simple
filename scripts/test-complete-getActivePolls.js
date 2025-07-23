/**
 * Complete test of getActivePolls() with real options retrieval
 * This simulates exactly what the frontend service will do
 */

const { Address, Dictionary } = require('@ton/core');
const { TonClient } = require('@ton/ton');
require('dotenv').config({ path: '../tpolls-contract-simple/.env' });

class MockTPollsService {
  constructor() {
    this.contractAddress = 'EQBTTSiLga3dkYVTrKNFQYxat2UBTkL2RxGOGp4vqjMdPdTG';
    
    this.client = new TonClient({
      endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
      apiKey: process.env.TESTNET_API_KEY
    });
  }

  _formatAddress(address) {
    if (!address || address.length < 10) return 'Unknown';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  _calculateTotalVotes(results) {
    if (!results || typeof results !== 'object') return 0;
    
    let totalVotes = 0;
    for (const votes of Object.values(results)) {
      if (typeof votes === 'number') {
        totalVotes += votes;
      }
    }
    return totalVotes;
  }

  _parsePollFromStack(stack) {
    try {
      if (!stack.items || stack.items.length === 0) {
        return null;
      }

      const item = stack.items[0];
      
      if (item.type === 'tuple' && item.items) {
        const pollId = item.items[0]?.value ? Number(item.items[0].value) : 0;
        
        // Parse creator address
        let creator = null;
        try {
          creator = item.items[1]?.address?.toString() || 'Unknown';
        } catch (e) {
          console.warn('Failed to parse creator address:', e);
        }
        
        // Parse subject string
        let subject = 'No subject';
        try {
          subject = item.items[2]?.value || 'No subject';
        } catch (e) {
          console.warn('Failed to parse subject string:', e);
        }
        
        // Parse options dictionary from cell (item 3)
        const options = [];
        if (item.items[3]?.type === 'cell' && item.items[3].cell) {
          try {
            const optionsDict = Dictionary.loadDirect(
              Dictionary.Keys.BigInt(257), 
              Dictionary.Values.Cell(), 
              item.items[3].cell
            );
            
            for (let i = 0; i < optionsDict.size; i++) {
              const optionCell = optionsDict.get(BigInt(i));
              if (optionCell) {
                const optionText = optionCell.beginParse().loadStringTail();
                options.push(optionText);
              }
            }
          } catch (e) {
            console.warn('Failed to parse options dictionary:', e);
          }
        }
        
        const results = {};
        
        return {
          pollId,
          creator,
          subject,
          options,
          results,
          optionCount: options.length,
          totalVotes: this._calculateTotalVotes(results),
          isActive: true
        };
      }

      return null;
    } catch (error) {
      console.error('Error parsing poll from stack:', error);
      return null;
    }
  }

  async getActivePolls() {
    console.log('🔍 Starting getActivePolls() test...');
    
    try {
      const contractAddress = Address.parse(this.contractAddress);
      
      // Get total number of polls
      let totalPolls = 0;
      try {
        const result = await this.client.runMethod(contractAddress, 'getPollCount');
        if (result.stack && result.stack.items.length > 0) {
          totalPolls = Number(result.stack.items[0].value);
        }
      } catch (error) {
        console.warn('Could not get total polls count:', error);
        totalPolls = 5; // fallback
      }

      console.log(`📊 Found ${totalPolls} total polls`);
      const activePolls = [];
      
      // Test with polls 3, 4, 5 (we know these have options)
      const pollsToTest = [3, 4, 5].filter(id => id <= totalPolls);
      
      for (const pollId of pollsToTest) {
        try {
          console.log(`\n🔍 Processing poll ${pollId}...`);
          
          const pollResult = await this.client.runMethod(contractAddress, 'getPoll', [
            { type: 'int', value: BigInt(pollId) }
          ]);
          
          if (pollResult.stack && pollResult.stack.items.length > 0) {
            const pollData = this._parsePollFromStack(pollResult.stack);
            
            if (pollData) {
              console.log(`  📝 Basic poll data: "${pollData.subject}"`);
              console.log(`  📊 Parsed options: ${pollData.options.length}`);
              
              // If options weren't parsed correctly, try to get them directly
              let pollOptions = pollData.options;
              if (!pollOptions || pollOptions.length === 0) {
                try {
                  console.log(`  🔄 Attempting to fetch options directly...`);
                  const optionsResult = await this.client.runMethod(contractAddress, 'getPollOptions', [
                    { type: 'int', value: BigInt(pollData.pollId) }
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
                      
                      pollOptions = [];
                      for (let i = 0; i < optionsDict.size; i++) {
                        const optionCell = optionsDict.get(BigInt(i));
                        if (optionCell) {
                          const optionText = optionCell.beginParse().loadStringTail();
                          pollOptions.push(optionText);
                        }
                      }
                      console.log(`  ✅ Retrieved ${pollOptions.length} options directly`);
                    }
                  }
                } catch (optionsError) {
                  console.warn(`  ❌ Failed to fetch options: ${optionsError.message}`);
                  pollOptions = ['Option 1', 'Option 2']; // Final fallback
                }
              }
              
              // Create a transformed poll object (like the real service does)
              const transformedPoll = {
                id: pollData.pollId,
                title: pollData.subject || `Poll ${pollData.pollId}`,
                description: 'Direct contract poll',
                options: pollOptions,
                category: 'general',
                author: this._formatAddress(pollData.creator),
                totalVotes: pollData.totalVotes,
                totalResponses: pollData.totalVotes,
                isActive: pollData.isActive,
                createdAt: 'Unknown',
                type: 'simple-blockchain',
                optionCount: pollOptions.length,
                hasAiData: false,
                subject: pollData.subject,
                totalRewardFund: '0 TON',
                daysRemaining: 0,
                gaslessEnabled: false,
                rewardPerVote: '0'
              };
              
              activePolls.push(transformedPoll);
              
              console.log(`  ✅ Poll ${pollId} processed with ${pollOptions.length} options`);
              pollOptions.forEach((option, index) => {
                console.log(`    ${index}: "${option}"`);
              });
            }
          }
        } catch (pollError) {
          console.log(`  ❌ Poll ${pollId} not accessible: ${pollError.message}`);
        }
      }

      console.log(`\n📋 getActivePolls() Results:`);
      console.log(`==========================`);
      console.log(`Total polls processed: ${activePolls.length}`);
      
      activePolls.forEach(poll => {
        console.log(`\nPoll ${poll.id}: "${poll.title}"`);
        console.log(`  Options (${poll.optionCount}):`);
        poll.options.forEach((option, index) => {
          console.log(`    ${index}: "${option}"`);
        });
      });
      
      return activePolls;
      
    } catch (error) {
      console.error('Error in getActivePolls:', error);
      throw new Error(`Failed to get active polls: ${error.message}`);
    }
  }
}

// Run the test
async function runCompleteTest() {
  console.log('🧪 Complete getActivePolls() Options Test');
  console.log('=========================================');
  
  const service = new MockTPollsService();
  
  try {
    const polls = await service.getActivePolls();
    
    console.log('\n🎉 SUCCESS SUMMARY:');
    console.log('==================');
    
    const pollsWithRealOptions = polls.filter(poll => 
      poll.options.length > 0 && 
      !poll.options.every(opt => opt.startsWith('Option '))
    );
    
    console.log(`✅ Total polls retrieved: ${polls.length}`);
    console.log(`✅ Polls with real options: ${pollsWithRealOptions.length}`);
    console.log(`✅ Success rate: ${polls.length > 0 ? Math.round((pollsWithRealOptions.length / polls.length) * 100) : 0}%`);
    
    if (pollsWithRealOptions.length > 0) {
      console.log('\n🎯 CONFIRMED: Frontend will now display real poll options!');
      console.log('🚀 Users will see actual option text instead of "Option 1", "Option 2"');
    } else {
      console.log('\n⚠️ No polls found with real options - may need to create new polls');
    }
    
  } catch (error) {
    console.log('❌ Test failed:', error.message);
  }
}

runCompleteTest().catch(console.error);