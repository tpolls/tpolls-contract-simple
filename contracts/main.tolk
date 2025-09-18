// TPollsDapp contract in Tolk with Jetton support
// Poll voting system with both TON and Jetton rewards

struct Poll {
    pollId: int;
    creator: address;
    subject: string;
    options: map<int, cell>;
    results: map<int, int>;
    totalVoters: int;
    rewardPool: int;
    rewardPerVote: int;
    jettonRewardWallet: address?;
    jettonRewardPool: int;
    jettonRewardPerVote: int;
}

struct CreatePoll {
    subject: string;
    options: map<int, cell>;
    rewardPerVote: int;
    jettonRewardWallet: address?;
    jettonRewardPerVote: int;
}

struct Vote {
    pollId: int;
    optionIndex: int;
}

struct ClaimReward {
    pollId: int;
    claimJetton: bool;
}

struct VoteEvent {
    pollId: int;
    voter: address;
    optionIndex: int;
    timestamp: int;
}

struct JettonTransferNotification {
    queryId: int;
    amount: int;
    sender: address;
    forwardPayload: slice;
}

struct FundPoll {
    pollId: int;
    isJetton: bool;
}

// Global storage variables
var owner: address;
var pollCount: int;
var polls: map<int, Poll>;
var voterPollKeys: map<int, bool>;

fun createVoterPollKey(voter: address, pollId: int): int {
    let cell: cell = beginCell()
        .storeAddress(voter)
        .storeUint(pollId, 64)
        .endCell();
    return cell.hash();
}

fun sendJettonTransfer(jettonWallet: address, amount: int, destination: address, forwardAmount: int, forwardPayload: cell) {
    // Send jetton transfer message
    send(SendParameters{
        to: jettonWallet,
        value: ton("0.05"),
        mode: SendIgnoreErrors,
        body: beginCell()
            .storeUint(0x0f8a7ea5, 32) // JettonTransfer opcode
            .storeUint(now(), 64) // queryId
            .storeCoins(amount)
            .storeAddress(destination)
            .storeAddress(destination) // responseDestination
            .storeBit(false) // customPayload null
            .storeCoins(forwardAmount)
            .storeRef(forwardPayload)
            .endCell()
    });
}

fun handleCreatePoll(msg: CreatePoll, sender: address) {
    pollCount = pollCount + 1;

    let poll: Poll = Poll{
        pollId: pollCount,
        creator: sender,
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

    polls.set(pollCount, poll);
}

fun handleVote(msg: Vote, sender: address) {
    let poll: Poll? = polls.get(msg.pollId);
    require(poll != null, "Poll does not exist");

    let currentPoll: Poll = poll!!;
    let optionExists: cell? = currentPoll.options.get(msg.optionIndex);
    require(optionExists != null, "Option does not exist");

    let voter: address = sender;
    let voterPollKey: int = createVoterPollKey(voter, msg.pollId);

    let hasVoted: bool? = voterPollKeys.get(voterPollKey);
    require(hasVoted != true, "Already voted in this poll");

    let currentVotes: int? = currentPoll.results.get(msg.optionIndex);
    let votesToAdd: int = 0;
    if (currentVotes != null) {
        votesToAdd = currentVotes!!;
    }
    currentPoll.results.set(msg.optionIndex, votesToAdd + 1);
    currentPoll.totalVoters = currentPoll.totalVoters + 1;

    voterPollKeys.set(voterPollKey, true);
    polls.set(msg.pollId, currentPoll);

    // Emit event
    emit(VoteEvent{
        pollId: msg.pollId,
        voter: voter,
        optionIndex: msg.optionIndex,
        timestamp: now()
    }.toCell());
}

fun handleClaimReward(msg: ClaimReward, sender: address) {
    let poll: Poll? = polls.get(msg.pollId);
    require(poll != null, "Poll does not exist");

    let currentPoll: Poll = poll!!;
    let voter: address = sender;

    let voterPollKey: int = createVoterPollKey(voter, msg.pollId);
    let hasVoted: bool? = voterPollKeys.get(voterPollKey);
    require(hasVoted == true, "Did not vote in this poll");

    if (msg.claimJetton) {
        require(currentPoll.jettonRewardPerVote > 0, "No jetton reward for this poll");
        require(currentPoll.jettonRewardPool >= currentPoll.jettonRewardPerVote, "Insufficient jetton reward pool");
        require(currentPoll.jettonRewardWallet != null, "No jetton wallet configured");

        sendJettonTransfer(currentPoll.jettonRewardWallet!!, currentPoll.jettonRewardPerVote, voter, 0, beginCell().endCell());
        currentPoll.jettonRewardPool = currentPoll.jettonRewardPool - currentPoll.jettonRewardPerVote;
    } else {
        require(currentPoll.rewardPerVote > 0, "No TON reward for this poll");
        require(currentPoll.rewardPool >= currentPoll.rewardPerVote, "Insufficient TON reward pool");

        send(SendParameters{
            to: voter,
            value: currentPoll.rewardPerVote,
            mode: SendIgnoreErrors
        });
        currentPoll.rewardPool = currentPoll.rewardPool - currentPoll.rewardPerVote;
    }

    polls.set(msg.pollId, currentPoll);
}

fun handleJettonTransferNotification(msg: JettonTransferNotification, sender: address) {
    if (msg.forwardPayload.bits() >= 32) {
        let forwardSlice: slice = msg.forwardPayload;
        let op: int = forwardSlice.loadUint(32);

        if (op == 0x46756E64) { // "Fund" opcode
            let pollId: int = forwardSlice.loadUint(32);
            let isJetton: bool = forwardSlice.loadBool();

            if (isJetton) {
                let poll: Poll? = polls.get(pollId);
                require(poll != null, "Poll does not exist");

                let currentPoll: Poll = poll!!;
                currentPoll.jettonRewardPool = currentPoll.jettonRewardPool + msg.amount;
                polls.set(pollId, currentPoll);
            }
        }
    }
}

fun handleFundPoll(msg: FundPoll, sender: address, msgValue: int) {
    let poll: Poll? = polls.get(msg.pollId);
    require(poll != null, "Poll does not exist");

    let currentPoll: Poll = poll!!;

    if (!msg.isJetton) {
        let rewardAmount: int = msgValue - ton("0.01");
        require(rewardAmount > 0, "Insufficient funding amount");

        currentPoll.rewardPool = currentPoll.rewardPool + rewardAmount;
        polls.set(msg.pollId, currentPoll);
    }
}

// Main message handler
fun recv_internal(msgValue: int, msgFull: cell, msgBody: slice) {
    let cs: slice = msgFull.beginParse();
    let flags: int = cs.loadUint(4);

    if (flags & 1) { // bounce message
        return;
    }

    let sender: address = cs.loadMsgAddr();

    if (msgBody.bits() < 32) {
        return; // No operation
    }

    let op: int = msgBody.loadUint(32);

    if (op == 0x6B6F6C74) { // "kolt" - CreatePoll
        let subject: string = msgBody.loadStringRefTail();
        let options: map<int, cell> = msgBody.loadDict();
        let rewardPerVote: int = msgBody.loadUint(64);
        let hasJettonWallet: bool = msgBody.loadBool();
        let jettonRewardWallet: address? = hasJettonWallet ? msgBody.loadAddress() : null;
        let jettonRewardPerVote: int = msgBody.loadUint(64);

        handleCreatePoll(CreatePoll{
            subject: subject,
            options: options,
            rewardPerVote: rewardPerVote,
            jettonRewardWallet: jettonRewardWallet,
            jettonRewardPerVote: jettonRewardPerVote
        }, sender);
    }
    else if (op == 0x566F7465) { // "Vote"
        let pollId: int = msgBody.loadUint(32);
        let optionIndex: int = msgBody.loadUint(32);

        handleVote(Vote{
            pollId: pollId,
            optionIndex: optionIndex
        }, sender);
    }
    else if (op == 0x636C6169) { // "clai" - ClaimReward
        let pollId: int = msgBody.loadUint(32);
        let claimJetton: bool = msgBody.loadBool();

        handleClaimReward(ClaimReward{
            pollId: pollId,
            claimJetton: claimJetton
        }, sender);
    }
    else if (op == 0x7362d09c) { // JettonTransferNotification
        let queryId: int = msgBody.loadUint(64);
        let amount: int = msgBody.loadCoins();
        let jettonSender: address = msgBody.loadAddress();
        let forwardPayload: slice = msgBody.loadRef().beginParse();

        handleJettonTransferNotification(JettonTransferNotification{
            queryId: queryId,
            amount: amount,
            sender: jettonSender,
            forwardPayload: forwardPayload
        }, sender);
    }
    else if (op == 0x46756E64) { // "Fund" - FundPoll
        let pollId: int = msgBody.loadUint(32);
        let isJetton: bool = msgBody.loadBool();

        handleFundPoll(FundPoll{
            pollId: pollId,
            isJetton: isJetton
        }, sender, msgValue);
    }
}

// Getter functions
get fun getPoll(pollId: int): Poll? {
    return polls.get(pollId);
}

get fun getPollCount(): int {
    return pollCount;
}

get fun getPollResults(pollId: int): map<int, int> {
    let poll: Poll? = polls.get(pollId);
    require(poll != null, "Poll does not exist");
    return poll!!.results;
}

get fun getAllPolls(): map<int, Poll> {
    return polls;
}

get fun getPollCreator(pollId: int): address {
    let poll: Poll? = polls.get(pollId);
    require(poll != null, "Poll does not exist");
    return poll!!.creator;
}

get fun getPollSubject(pollId: int): string {
    let poll: Poll? = polls.get(pollId);
    require(poll != null, "Poll does not exist");
    return poll!!.subject;
}

get fun getPollOptions(pollId: int): map<int, cell> {
    let poll: Poll? = polls.get(pollId);
    require(poll != null, "Poll does not exist");
    return poll!!.options;
}

get fun hasVoted(pollId: int, voter: address): bool {
    let voterPollKey: int = createVoterPollKey(voter, pollId);
    let voted: bool? = voterPollKeys.get(voterPollKey);
    return voted == true;
}

get fun getPollTotalVoters(pollId: int): int {
    let poll: Poll? = polls.get(pollId);
    require(poll != null, "Poll does not exist");
    return poll!!.totalVoters;
}

get fun getPollRewardPool(pollId: int): int {
    let poll: Poll? = polls.get(pollId);
    require(poll != null, "Poll does not exist");
    return poll!!.rewardPool;
}

get fun getPollRewardPerVote(pollId: int): int {
    let poll: Poll? = polls.get(pollId);
    require(poll != null, "Poll does not exist");
    return poll!!.rewardPerVote;
}

get fun getPollJettonRewardWallet(pollId: int): address? {
    let poll: Poll? = polls.get(pollId);
    require(poll != null, "Poll does not exist");
    return poll!!.jettonRewardWallet;
}

get fun getPollJettonRewardPool(pollId: int): int {
    let poll: Poll? = polls.get(pollId);
    require(poll != null, "Poll does not exist");
    return poll!!.jettonRewardPool;
}

get fun getPollJettonRewardPerVote(pollId: int): int {
    let poll: Poll? = polls.get(pollId);
    require(poll != null, "Poll does not exist");
    return poll!!.jettonRewardPerVote;
}