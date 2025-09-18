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
    jettonRewardWallet: Address?;
    jettonRewardPool: Int;
    jettonRewardPerVote: Int;
}

message CreatePoll {
    subject: String;
    options: map<Int, Cell>;
    rewardPerVote: Int;
    jettonRewardWallet: Address?;
    jettonRewardPerVote: Int;
}

message Vote {
    pollId: Int;
    optionIndex: Int;
}

message ClaimReward {
    pollId: Int;
    claimJetton: Bool;
}

message VoteEvent {
    pollId: Int;
    voter: Address;
    optionIndex: Int;
    timestamp: Int;
}

// Jetton-related messages
message(0x7362d09c) JettonTransferNotification {
    query_id: Int as uint64;
    amount: Int as coins;
    sender: Address;
    forward_payload: Slice as remaining;
}

message(0x0f8a7ea5) JettonTransfer {
    query_id: Int as uint64;
    amount: Int as coins;
    destination: Address;
    response_destination: Address;
    custom_payload: Cell?;
    forward_ton_amount: Int as coins;
    forward_payload: Slice as remaining;
}

message FundPoll {
    pollId: Int;
    isJetton: Bool;
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
            rewardPerVote: msg.rewardPerVote,
            jettonRewardWallet: msg.jettonRewardWallet,
            jettonRewardPool: 0,
            jettonRewardPerVote: msg.jettonRewardPerVote
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

        if (msg.claimJetton) {
            // Claim jetton reward
            require(currentPoll.jettonRewardPerVote > 0, "No jetton reward for this poll");
            require(currentPoll.jettonRewardPool >= currentPoll.jettonRewardPerVote, "Insufficient jetton reward pool");
            require(currentPoll.jettonRewardWallet != null, "No jetton wallet configured");

            // Send jetton transfer to voter
            send(SendParameters{
                to: currentPoll.jettonRewardWallet!!,
                value: ton("0.05"),
                mode: SendIgnoreErrors,
                body: JettonTransfer{
                    query_id: now(),
                    amount: currentPoll.jettonRewardPerVote,
                    destination: voter,
                    response_destination: voter,
                    custom_payload: null,
                    forward_ton_amount: 0,
                    forward_payload: emptySlice()
                }.toCell()
            });

            // Update jetton reward pool
            currentPoll.jettonRewardPool = currentPoll.jettonRewardPool - currentPoll.jettonRewardPerVote;
        } else {
            // Claim TON reward
            require(currentPoll.rewardPerVote > 0, "No TON reward for this poll");
            require(currentPoll.rewardPool >= currentPoll.rewardPerVote, "Insufficient TON reward pool");

            // Send TON to voter
            send(SendParameters{
                to: voter,
                value: currentPoll.rewardPerVote,
                mode: SendIgnoreErrors
            });

            // Update TON reward pool
            currentPoll.rewardPool = currentPoll.rewardPool - currentPoll.rewardPerVote;
        }

        self.polls.set(msg.pollId, currentPoll);
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

    // Jetton-related getters
    get fun getPollJettonRewardWallet(pollId: Int): Address? {
        let poll: Poll? = self.polls.get(pollId);
        require(poll != null, "Poll does not exist");
        return poll!!.jettonRewardWallet;
    }

    get fun getPollJettonRewardPool(pollId: Int): Int {
        let poll: Poll? = self.polls.get(pollId);
        require(poll != null, "Poll does not exist");
        return poll!!.jettonRewardPool;
    }

    get fun getPollJettonRewardPerVote(pollId: Int): Int {
        let poll: Poll? = self.polls.get(pollId);
        require(poll != null, "Poll does not exist");
        return poll!!.jettonRewardPerVote;
    }

    // Handle jetton transfer notifications for funding polls
    receive(msg: JettonTransferNotification) {
        // Parse forward payload for poll funding
        if (msg.forward_payload.bits() >= 32) {
            let forwardSlice: Slice = msg.forward_payload;
            let op: Int = forwardSlice.loadUint(32);

            if (op == 0x46756E64) { // "Fund" opcode
                let pollId: Int = forwardSlice.loadUint(32);
                let isJetton: Bool = forwardSlice.loadBool();

                if (isJetton) {
                    let poll: Poll? = self.polls.get(pollId);
                    require(poll != null, "Poll does not exist");

                    let currentPoll: Poll = poll!!;
                    currentPoll.jettonRewardPool = currentPoll.jettonRewardPool + msg.amount;
                    self.polls.set(pollId, currentPoll);
                }
            }
        }
    }

    // Handle direct poll funding with TON
    receive(msg: FundPoll) {
        let poll: Poll? = self.polls.get(msg.pollId);
        require(poll != null, "Poll does not exist");

        let currentPoll: Poll = poll!!;

        if (!msg.isJetton) {
            // Add to TON reward pool (subtract gas costs)
            let rewardAmount: Int = context().value - ton("0.01"); // Reserve 0.01 TON for gas
            require(rewardAmount > 0, "Insufficient funding amount");

            currentPoll.rewardPool = currentPoll.rewardPool + rewardAmount;
            self.polls.set(msg.pollId, currentPoll);
        }
    }

}