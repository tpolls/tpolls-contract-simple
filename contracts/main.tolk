// TPollsDapp contract converted from Tact to Tolk
// Poll voting system with rewards

struct Poll {
    pollId: int,
    creator: address,
    subject: string,
    options: HashmapE<int, cell>,
    results: HashmapE<int, int>,
    totalVoters: int,
    rewardPool: int,
    rewardPerVote: int,
    jettonRewardWallet: address?,
    jettonRewardPool: int,
    jettonRewardPerVote: int,
}

struct CreatePoll {
    subject: string,
    options: HashmapE<int, cell>,
    rewardPerVote: int,
    jettonRewardWallet: address?,
    jettonRewardPerVote: int,
}

struct Vote {
    pollId: int,
    optionIndex: int,
}

struct ClaimReward {
    pollId: int,
    claimJetton: bool,
}

struct VoteEvent {
    pollId: int,
    voter: address,
    optionIndex: int,
    timestamp: int,
}

// Jetton-related message structures
struct JettonTransferNotification {
    query_id: int,
    amount: int,
    sender: address,
    forward_payload: slice,
}

struct JettonTransfer {
    query_id: int,
    amount: int,
    destination: address,
    response_destination: address,
    custom_payload: cell?,
    forward_ton_amount: int,
    forward_payload: cell,
}

struct JettonBurn {
    query_id: int,
    amount: int,
    response_destination: address,
    custom_payload: cell?,
}

struct FundPoll {
    pollId: int,
    isJetton: bool,
}

global owner: address
global pollCount: int
global polls: HashmapE<int, Poll>
global voterPollKeys: HashmapE<int, bool>
global jettonWallets: HashmapE<int, address> // pollId -> jetton wallet address
global contractJettonWallet: address? // Our contract's jetton wallet address

fun createVoterPollKey(voter: address, pollId: int): int {
    // Create a hash combining voter address and poll ID
    val cell: cell = beginCell()
        .storeAddress(voter)
        .storeUint(pollId, 64)
        .endCell()
    return cell.cellHash()
}

// Calculate jetton wallet address for given owner and jetton master
fun calculateJettonWalletAddress(owner: address, jettonMaster: address): address {
    // This is a simplified version - in practice you'd need the exact wallet code
    val initData: cell = beginCell()
        .storeAddress(owner)
        .storeAddress(jettonMaster)
        .endCell()

    // Return placeholder address - in real implementation, use state_init calculation
    return owner // Simplified for now
}

// Send jetton transfer message
fun sendJettonTransfer(jettonWallet: address, amount: int, destination: address, forwardAmount: int, forwardPayload: cell) {
    val transfer: JettonTransfer = JettonTransfer {
        query_id: now(),
        amount: amount,
        destination: destination,
        response_destination: destination,
        custom_payload: null,
        forward_ton_amount: forwardAmount,
        forward_payload: forwardPayload
    }

    val msg: cell = beginCell()
        .storeUint(0x0f8a7ea5, 32) // JettonTransfer opcode
        .store(transfer.pack())
        .endCell()

    // Send message with some TON for gas
    send_raw_message(beginCell()
        .storeUint(0x18, 6)
        .storeAddress(jettonWallet)
        .storeCoins(50000000) // 0.05 TON for gas
        .storeUint(1, 1 + 4 + 4 + 64 + 32 + 1 + 1)
        .storeRef(msg)
        .endCell(), 1)
}

// Constructor equivalent
fun init(ownerAddr: address) {
    owner = ownerAddr
    pollCount = 0
    polls = null
    voterPollKeys = null
    jettonWallets = null
    contractJettonWallet = null
}

// Handle CreatePoll message
fun handleCreatePoll(msg: CreatePoll, sender: address) {
    pollCount = pollCount + 1

    val poll: Poll = Poll {
        pollId: pollCount,
        creator: sender,
        subject: msg.subject,
        options: msg.options,
        results: null,
        totalVoters: 0,
        rewardPool: 0,
        rewardPerVote: msg.rewardPerVote,
        jettonRewardWallet: msg.jettonRewardWallet,
        jettonRewardPool: 0,
        jettonRewardPerVote: msg.jettonRewardPerVote
    }

    polls = polls.udict_set(256, pollCount, poll.pack())

    // If jetton rewards are configured, store the jetton wallet
    if (msg.jettonRewardWallet != null) {
        jettonWallets = jettonWallets.udict_set(256, pollCount, msg.jettonRewardWallet!!)
    }
}

// Handle Vote message
fun handleVote(msg: Vote, sender: address) {
    val pollCell: cell? = polls.udict_get(256, msg.pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"
    
    val currentPoll: Poll = pollCell!!.unpack<Poll>()
    val optionExists: cell? = currentPoll.options.udict_get(256, msg.optionIndex)
    throw_unless(401, optionExists != null) // "Option does not exist"
    
    val voter: address = sender
    
    // Create compound key for voter-poll combination
    val voterPollKey: int = createVoterPollKey(voter, msg.pollId)
    
    // Check if voter has already voted in this poll
    val hasVoted: bool? = voterPollKeys.udict_get(256, voterPollKey)
    throw_if(402, hasVoted == true) // "Already voted in this poll"
    
    // Update vote counts
    val currentVotes: int? = currentPoll.results.udict_get(256, msg.optionIndex)
    val votesToAdd: int = (currentVotes != null) ? currentVotes!! : 0
    
    val updatedResults = currentPoll.results.udict_set(256, msg.optionIndex, votesToAdd + 1)
    
    // Create updated poll
    val updatedPoll: Poll = Poll {
        pollId: currentPoll.pollId,
        creator: currentPoll.creator,
        subject: currentPoll.subject,
        options: currentPoll.options,
        results: updatedResults,
        totalVoters: currentPoll.totalVoters + 1,
        rewardPool: currentPoll.rewardPool,
        rewardPerVote: currentPoll.rewardPerVote,
        jettonRewardWallet: currentPoll.jettonRewardWallet,
        jettonRewardPool: currentPoll.jettonRewardPool,
        jettonRewardPerVote: currentPoll.jettonRewardPerVote
    }
    
    // Mark voter as having voted in this poll
    voterPollKeys = voterPollKeys.udict_set(256, voterPollKey, true)
    
    // Update poll
    polls = polls.udict_set(256, msg.pollId, updatedPoll.pack())
    
    // Emit event for off-chain tracking
    val event: VoteEvent = VoteEvent {
        pollId: msg.pollId,
        voter: voter,
        optionIndex: msg.optionIndex,
        timestamp: now()
    }
    emit_log(event.pack())
}

// Handle jetton transfer notification for funding polls
fun handleJettonTransferNotification(msg: JettonTransferNotification, sender: address) {
    // Parse forward payload to get poll funding info
    val payload: slice = msg.forward_payload

    if (payload.slice_bits() >= 32) {
        val op: int = payload~load_uint(32)
        if (op == 0x46756E64) { // "Fund" opcode
            val fundMsg: FundPoll = payload~load_fund_poll()

            val pollCell: cell? = polls.udict_get(256, fundMsg.pollId)
            throw_unless(400, pollCell != null) // "Poll does not exist"

            val currentPoll: Poll = pollCell!!.unpack<Poll>()

            if (fundMsg.isJetton) {
                // Add to jetton reward pool
                val updatedPoll: Poll = Poll {
                    pollId: currentPoll.pollId,
                    creator: currentPoll.creator,
                    subject: currentPoll.subject,
                    options: currentPoll.options,
                    results: currentPoll.results,
                    totalVoters: currentPoll.totalVoters,
                    rewardPool: currentPoll.rewardPool,
                    rewardPerVote: currentPoll.rewardPerVote,
                    jettonRewardWallet: currentPoll.jettonRewardWallet,
                    jettonRewardPool: currentPoll.jettonRewardPool + msg.amount,
                    jettonRewardPerVote: currentPoll.jettonRewardPerVote
                }

                polls = polls.udict_set(256, fundMsg.pollId, updatedPoll.pack())
            }
        }
    }
}

// Handle funding polls with TON
fun handleFundPoll(msg: FundPoll, sender: address, msgValue: int) {
    val pollCell: cell? = polls.udict_get(256, msg.pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"

    val currentPoll: Poll = pollCell!!.unpack<Poll>()

    if (!msg.isJetton) {
        // Add to TON reward pool (subtract gas costs)
        val rewardAmount: int = msgValue - 10000000 // Reserve 0.01 TON for gas
        throw_unless(401, rewardAmount > 0) // "Insufficient funding amount"

        val updatedPoll: Poll = Poll {
            pollId: currentPoll.pollId,
            creator: currentPoll.creator,
            subject: currentPoll.subject,
            options: currentPoll.options,
            results: currentPoll.results,
            totalVoters: currentPoll.totalVoters,
            rewardPool: currentPoll.rewardPool + rewardAmount,
            rewardPerVote: currentPoll.rewardPerVote,
            jettonRewardWallet: currentPoll.jettonRewardWallet,
            jettonRewardPool: currentPoll.jettonRewardPool,
            jettonRewardPerVote: currentPoll.jettonRewardPerVote
        }

        polls = polls.udict_set(256, msg.pollId, updatedPoll.pack())
    }
}

// Handle ClaimReward message
fun handleClaimReward(msg: ClaimReward, sender: address) {
    val pollCell: cell? = polls.udict_get(256, msg.pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"

    val currentPoll: Poll = pollCell!!.unpack<Poll>()
    val voter: address = sender

    // Check if voter actually voted in this poll
    val voterPollKey: int = createVoterPollKey(voter, msg.pollId)
    val hasVoted: bool? = voterPollKeys.udict_get(256, voterPollKey)
    throw_unless(403, hasVoted == true) // "Did not vote in this poll"

    val updatedPoll: Poll = currentPoll

    if (msg.claimJetton) {
        // Claim jetton reward
        throw_unless(404, currentPoll.jettonRewardPerVote > 0) // "No jetton reward for this poll"
        throw_unless(405, currentPoll.jettonRewardPool >= currentPoll.jettonRewardPerVote) // "Insufficient jetton reward pool"
        throw_unless(406, currentPoll.jettonRewardWallet != null) // "No jetton wallet configured"

        // Send jetton transfer to voter
        val jettonWallet: address = currentPoll.jettonRewardWallet!!
        sendJettonTransfer(jettonWallet, currentPoll.jettonRewardPerVote, voter, 0, beginCell().endCell())

        // Update jetton reward pool
        updatedPoll = Poll {
            pollId: currentPoll.pollId,
            creator: currentPoll.creator,
            subject: currentPoll.subject,
            options: currentPoll.options,
            results: currentPoll.results,
            totalVoters: currentPoll.totalVoters,
            rewardPool: currentPoll.rewardPool,
            rewardPerVote: currentPoll.rewardPerVote,
            jettonRewardWallet: currentPoll.jettonRewardWallet,
            jettonRewardPool: currentPoll.jettonRewardPool - currentPoll.jettonRewardPerVote,
            jettonRewardPerVote: currentPoll.jettonRewardPerVote
        }
    } else {
        // Claim TON reward
        throw_unless(404, currentPoll.rewardPerVote > 0) // "No TON reward for this poll"
        throw_unless(405, currentPoll.rewardPool >= currentPoll.rewardPerVote) // "Insufficient TON reward pool"

        // Send TON to voter
        send_raw_message(beginCell()
            .storeUint(0x18, 6)
            .storeAddress(voter)
            .storeCoins(currentPoll.rewardPerVote)
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
            .endCell(), 1)

        // Update TON reward pool
        updatedPoll = Poll {
            pollId: currentPoll.pollId,
            creator: currentPoll.creator,
            subject: currentPoll.subject,
            options: currentPoll.options,
            results: currentPoll.results,
            totalVoters: currentPoll.totalVoters,
            rewardPool: currentPoll.rewardPool - currentPoll.rewardPerVote,
            rewardPerVote: currentPoll.rewardPerVote,
            jettonRewardWallet: currentPoll.jettonRewardWallet,
            jettonRewardPool: currentPoll.jettonRewardPool,
            jettonRewardPerVote: currentPoll.jettonRewardPerVote
        }
    }

    polls = polls.udict_set(256, msg.pollId, updatedPoll.pack())
}

// Getter functions
get fun getPoll(pollId: int): Poll? {
    val pollCell: cell? = polls.udict_get(256, pollId)
    return (pollCell != null) ? pollCell!!.unpack<Poll>() : null
}

get fun getPollCount(): int {
    return pollCount
}

get fun getPollResults(pollId: int): HashmapE<int, int> {
    val pollCell: cell? = polls.udict_get(256, pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"
    return pollCell!!.unpack<Poll>().results
}

get fun getAllPolls(): HashmapE<int, Poll> {
    return polls
}

get fun getPollCreator(pollId: int): address {
    val pollCell: cell? = polls.udict_get(256, pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"
    return pollCell!!.unpack<Poll>().creator
}

get fun getPollSubject(pollId: int): string {
    val pollCell: cell? = polls.udict_get(256, pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"
    return pollCell!!.unpack<Poll>().subject
}

get fun getPollOptions(pollId: int): HashmapE<int, cell> {
    val pollCell: cell? = polls.udict_get(256, pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"
    return pollCell!!.unpack<Poll>().options
}

get fun hasVoted(pollId: int, voter: address): bool {
    val voterPollKey: int = createVoterPollKey(voter, pollId)
    val voted: bool? = voterPollKeys.udict_get(256, voterPollKey)
    return voted == true
}

get fun getPollTotalVoters(pollId: int): int {
    val pollCell: cell? = polls.udict_get(256, pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"
    return pollCell!!.unpack<Poll>().totalVoters
}

get fun getPollRewardPool(pollId: int): int {
    val pollCell: cell? = polls.udict_get(256, pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"
    return pollCell!!.unpack<Poll>().rewardPool
}

get fun getPollRewardPerVote(pollId: int): int {
    val pollCell: cell? = polls.udict_get(256, pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"
    return pollCell!!.unpack<Poll>().rewardPerVote
}

get fun getPollJettonRewardWallet(pollId: int): address? {
    val pollCell: cell? = polls.udict_get(256, pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"
    return pollCell!!.unpack<Poll>().jettonRewardWallet
}

get fun getPollJettonRewardPool(pollId: int): int {
    val pollCell: cell? = polls.udict_get(256, pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"
    return pollCell!!.unpack<Poll>().jettonRewardPool
}

get fun getPollJettonRewardPerVote(pollId: int): int {
    val pollCell: cell? = polls.udict_get(256, pollId)
    throw_unless(400, pollCell != null) // "Poll does not exist"
    return pollCell!!.unpack<Poll>().jettonRewardPerVote
}

// Main message handler
() recv_internal(int msg_value, cell in_msg_cell, slice in_msg) impure {
    var cs = in_msg_cell.begin_parse()
    var flags = cs~load_uint(4)

    if (flags & 1) { // bounce message
        return ()
    }

    var sender_addr = cs~load_msg_addr()
    var op = in_msg~load_uint(32)

    if (op == 0x6B6F6C74) { // "kolt" - CreatePoll
        var msg = in_msg~load_create_poll()
        handleCreatePoll(msg, sender_addr)
    } elseif (op == 0x566F7465) { // "Vote"
        var msg = in_msg~load_vote()
        handleVote(msg, sender_addr)
    } elseif (op == 0x636C6169) { // "clai" - ClaimReward
        var msg = in_msg~load_claim_reward()
        handleClaimReward(msg, sender_addr)
    } elseif (op == 0x7362d09c) { // JettonTransferNotification
        var msg = in_msg~load_jetton_transfer_notification()
        handleJettonTransferNotification(msg, sender_addr)
    } elseif (op == 0x46756E64) { // "Fund" - FundPoll
        var msg = in_msg~load_fund_poll()
        handleFundPoll(msg, sender_addr, msg_value)
    }
}