/**
 * Test script to verify getActivePolls() retrieves actual options from contract
 */

const { Address, Dictionary } = require('@ton/core');
const { TonClient } = require('@ton/ton');
require('dotenv').config();

// Simulate the contract service's getActivePolls method
class TestContractService {
  constructor() {
    this.contractAddress = 'EQBTTSiLga3dkYVTrKNFQYxat2UBTkL2RxGOGp4vqjMdPdTG';
    
    // Initialize TON client
    const network = 'testnet';
    const toncenterEndpoint = 'https://testnet.toncenter.com/api/v2/jsonRPC';
    
    this.client = new TonClient({
      endpoint: toncenterEndpoint,
      apiKey: process.env.TESTNET_API_KEY
    });
  }

  async testGetPollOptions(pollId) {
    console.log(`\n🔍 Testing getPollOptions for poll ${pollId}...`);
    
    try {
      const contractAddress = Address.parse(this.contractAddress);
      const optionsResult = await this.client.runMethod(contractAddress, 'getPollOptions', [
        { type: 'int', value: BigInt(pollId) }
      ]);
      
      console.log('Options result:', {
        exit_code: optionsResult.exit_code,
        stack_remaining: optionsResult.stack ? optionsResult.stack.remaining : 'no stack'
      });
      
      if (optionsResult.stack && optionsResult.stack.remaining > 0) {
        const optionsCell = optionsResult.stack.readCellOpt();
        if (optionsCell) {
          const optionsDict = Dictionary.loadDirect(
            Dictionary.Keys.BigInt(257), 
            Dictionary.Values.Cell(), 
            optionsCell
          );
          
          const options = [];
          for (let i = 0; i < optionsDict.size; i++) {
            const optionCell = optionsDict.get(BigInt(i));
            if (optionCell) {
              const optionText = optionCell.beginParse().loadStringTail();
              options.push(optionText);
            }
          }
          
          console.log(`✅ Retrieved ${options.length} options for poll ${pollId}:`);
          options.forEach((option, index) => {
            console.log(`  ${index}: "${option}"`);
          });
          
          return options;
        } else {
          console.log('❌ No options cell returned');
          return [];
        }
      } else {
        console.log('❌ No stack data returned');
        return [];
      }
    } catch (error) {
      console.log('❌ Error getting options:', error.message);
      return [];
    }
  }

  async testGetActivePollsOptionsRetrieval() {
    console.log('🧪 Testing getActivePolls Options Retrieval');
    console.log('==========================================');
    
    try {
      const contractAddress = Address.parse(this.contractAddress);
      
      // Get poll count first
      const countResult = await this.client.runMethod(contractAddress, 'getPollCount');
      const totalPolls = countResult.stack ? Number(countResult.stack.readBigNumber()) : 0;
      
      console.log(`📊 Total polls in contract: ${totalPolls}`);
      
      if (totalPolls === 0) {
        console.log('❌ No polls found to test');
        return;
      }
      
      // Test retrieving options for each poll
      const pollsWithOptions = [];
      
      for (let pollId = 1; pollId <= Math.min(totalPolls, 5); pollId++) { // Test first 5 polls max
        try {
          // First get basic poll data
          const pollResult = await this.client.runMethod(contractAddress, 'getPoll', [
            { type: 'int', value: BigInt(pollId) }
          ]);
          
          if (pollResult.stack && pollResult.stack.remaining > 0) {
            const pollTuple = pollResult.stack.readTupleOpt();
            if (pollTuple) {
              const pollId_parsed = pollTuple.readBigNumber();
              const creator = pollTuple.readAddress();
              const subject = pollTuple.readString();
              
              console.log(`\n📝 Poll ${pollId}:`);
              console.log(`  Subject: "${subject}"`);
              console.log(`  Creator: ${creator.toString().slice(0, 10)}...`);
              
              // Now get the options
              const options = await this.testGetPollOptions(pollId);
              
              pollsWithOptions.push({
                id: Number(pollId_parsed),
                subject,
                options,
                creator: creator.toString()
              });
            }
          }
        } catch (pollError) {
          console.log(`⚠️ Could not access poll ${pollId}: ${pollError.message}`);
        }
      }
      
      // Summary
      console.log('\n📋 Summary of Polls with Options:');
      console.log('==================================');
      
      pollsWithOptions.forEach(poll => {
        console.log(`\nPoll ${poll.id}: "${poll.subject}"`);
        if (poll.options.length > 0) {
          console.log('  ✅ Options retrieved from contract:');
          poll.options.forEach((option, index) => {
            console.log(`    ${index}: "${option}"`);
          });
        } else {
          console.log('  ❌ No options found (would fall back to generic options)');
        }
      });
      
      const pollsWithRealOptions = pollsWithOptions.filter(poll => poll.options.length > 0);
      
      console.log(`\n🎯 Results:`);
      console.log(`  Total polls tested: ${pollsWithOptions.length}`);
      console.log(`  Polls with real options: ${pollsWithRealOptions.length}`);
      console.log(`  Success rate: ${pollsWithOptions.length > 0 ? Math.round((pollsWithRealOptions.length / pollsWithOptions.length) * 100) : 0}%`);
      
      if (pollsWithRealOptions.length > 0) {
        console.log('\n✅ SUCCESS: getActivePolls() will now display real options from the contract!');
      } else {
        console.log('\n⚠️ WARNING: No polls found with options. Either:');
        console.log('  1. Polls were created with old contract (no options)');
        console.log('  2. Options parsing needs debugging');
      }
      
    } catch (error) {
      console.log('❌ Error testing active polls:', error.message);
    }
  }
}

// Run the test
async function runTest() {
  const service = new TestContractService();
  await service.testGetActivePollsOptionsRetrieval();
}

runTest().catch(console.error);