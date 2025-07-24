import "@stdlib/deploy";
import "@stdlib/ownable";

struct Poll {
    pollId: Int;
    creator: Address;
    subject: String;
    options: map<Int, Cell>;
    results: map<Int, Int>;
    totalVoters: Int;
    rewardPool: Int;
    rewardPerVote: Int;
}

message CreatePoll {
    subject: String;
    options: map<Int, Cell>;
    rewardPerVote: Int;
}

message Vote {
    pollId: Int;
    optionIndex: Int;
}

message ClaimReward {
    pollId: Int;
}

message VoteEvent {
    pollId: Int;
    voter: Address;
    optionIndex: Int;
    timestamp: Int;
}

contract TPollsDapp with Deployable, Ownable {
    owner: Address;
    pollCount: Int as uint64;
    polls: map<Int, Poll>;
    voterPollKeys: map<Int, Bool>;
    
    init(owner: Address) {
        self.owner = owner;
        self.pollCount = 0;
    }
    
    fun createVoterPollKey(voter: Address, pollId: Int): Int {
        // Create a hash combining voter address and poll ID
        let cell: Cell = beginCell()
            .storeAddress(voter)
            .storeUint(pollId, 64)
            .endCell();
        return cell.hash();
    }
    
    receive(msg: CreatePoll) {
        self.pollCount = self.pollCount + 1;
        
        let poll: Poll = Poll{
            pollId: self.pollCount,
            creator: sender(),
            subject: msg.subject,
            options: msg.options,
            results: emptyMap(),
            totalVoters: 0,
            rewardPool: 0,
            rewardPerVote: msg.rewardPerVote
        };
        
        self.polls.set(self.pollCount, poll);
    }
    
    receive(msg: Vote) {
        let poll: Poll? = self.polls.get(msg.pollId);
        require(poll != null, "Poll does not exist");
        
        let currentPoll: Poll = poll!!;
        let optionExists: Cell? = currentPoll.options.get(msg.optionIndex);
        require(optionExists != null, "Option does not exist");
        
        let voter: Address = sender();
        
        // Create compound key for voter-poll combination
        let voterPollKey: Int = self.createVoterPollKey(voter, msg.pollId);
        
        // Check if voter has already voted in this poll
        let hasVoted: Bool? = self.voterPollKeys.get(voterPollKey);
        require(hasVoted != true, "Already voted in this poll");
        
        // Update vote counts
        let currentVotes: Int? = currentPoll.results.get(msg.optionIndex);
        let votesToAdd: Int = 0;
        if (currentVotes != null) {
            votesToAdd = currentVotes!!;
        }
        currentPoll.results.set(msg.optionIndex, votesToAdd + 1);
        
        // Increment total unique voters
        currentPoll.totalVoters = currentPoll.totalVoters + 1;
        
        // Mark voter as having voted in this poll
        self.voterPollKeys.set(voterPollKey, true);
        
        // Update poll
        self.polls.set(msg.pollId, currentPoll);
        
        // Emit event for off-chain tracking
        emit(VoteEvent{
            pollId: msg.pollId,
            voter: voter,
            optionIndex: msg.optionIndex,
            timestamp: now()
        }.toCell());
    }
    
    receive(msg: ClaimReward) {
        let poll: Poll? = self.polls.get(msg.pollId);
        require(poll != null, "Poll does not exist");
        
        let currentPoll: Poll = poll!!;
        let voter: Address = sender();
        
        // Check if voter actually voted in this poll
        let voterPollKey: Int = self.createVoterPollKey(voter, msg.pollId);
        let hasVoted: Bool? = self.voterPollKeys.get(voterPollKey);
        require(hasVoted == true, "Did not vote in this poll");
        
        // Check if reward is available
        require(currentPoll.rewardPerVote > 0, "No reward for this poll");
        require(currentPoll.rewardPool >= currentPoll.rewardPerVote, "Insufficient reward pool");
        
        // Transfer reward (simplified - in practice you'd need proper TON transfer logic)
        currentPoll.rewardPool = currentPoll.rewardPool - currentPoll.rewardPerVote;
        self.polls.set(msg.pollId, currentPoll);
        
        // Note: Actual TON transfer would be implemented here
        // For now, we're just tracking the reward claim in the pool reduction
    }
    
    get fun getPoll(pollId: Int): Poll? {
        return self.polls.get(pollId);
    }
    
    get fun getPollCount(): Int {
        return self.pollCount;
    }
    
    get fun getPollResults(pollId: Int): map<Int, Int> {
        let poll: Poll? = self.polls.get(pollId);
        require(poll != null, "Poll does not exist");
        return poll!!.results;
    }
    
    get fun getAllPolls(): map<Int, Poll> {
        return self.polls;
    }
    
    get fun getPollCreator(pollId: Int): Address {
        let poll: Poll? = self.polls.get(pollId);
        require(poll != null, "Poll does not exist");
        return poll!!.creator;
    }
    
    get fun getPollSubject(pollId: Int): String {
        let poll: Poll? = self.polls.get(pollId);
        require(poll != null, "Poll does not exist");
        return poll!!.subject;
    }
    
    get fun getPollOptions(pollId: Int): map<Int, Cell> {
        let poll: Poll? = self.polls.get(pollId);
        require(poll != null, "Poll does not exist");
        return poll!!.options;
    }
    
    get fun hasVoted(pollId: Int, voter: Address): Bool {
        let voterPollKey: Int = self.createVoterPollKey(voter, pollId);
        let voted: Bool? = self.voterPollKeys.get(voterPollKey);
        return voted == true;
    }
    
    get fun getPollTotalVoters(pollId: Int): Int {
        let poll: Poll? = self.polls.get(pollId);
        require(poll != null, "Poll does not exist");
        return poll!!.totalVoters;
    }
    
    get fun getPollRewardPool(pollId: Int): Int {
        let poll: Poll? = self.polls.get(pollId);
        require(poll != null, "Poll does not exist");
        return poll!!.rewardPool;
    }
    
    get fun getPollRewardPerVote(pollId: Int): Int {
        let poll: Poll? = self.polls.get(pollId);
        require(poll != null, "Poll does not exist");
        return poll!!.rewardPerVote;
    }
    
}