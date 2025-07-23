import "@stdlib/deploy";
import "@stdlib/ownable";

struct Poll {
    pollId: Int;
    creator: Address;
    subject: String;
    options: map<Int, Cell>;
    results: map<Int, Int>;
}

message CreatePoll {
    subject: String;
    options: map<Int, Cell>;
}

message Vote {
    pollId: Int;
    optionIndex: Int;
}

contract TPollsDapp with Deployable, Ownable {
    owner: Address;
    pollCount: Int as uint64;
    polls: map<Int, Poll>;
    
    init(owner: Address) {
        self.owner = owner;
        self.pollCount = 0;
    }
    
    receive(msg: CreatePoll) {
        self.pollCount = self.pollCount + 1;
        
        let poll: Poll = Poll{
            pollId: self.pollCount,
            creator: sender(),
            subject: msg.subject,
            options: msg.options,
            results: emptyMap()
        };
        
        self.polls.set(self.pollCount, poll);
    }
    
    receive(msg: Vote) {
        let poll: Poll? = self.polls.get(msg.pollId);
        require(poll != null, "Poll does not exist");
        
        let currentPoll: Poll = poll!!;
        let optionExists: Cell? = currentPoll.options.get(msg.optionIndex);
        require(optionExists != null, "Option does not exist");
        
        let currentVotes: Int? = currentPoll.results.get(msg.optionIndex);
        let votesToAdd: Int = 0;
        if (currentVotes != null) {
            votesToAdd = currentVotes!!;
        }
        currentPoll.results.set(msg.optionIndex, votesToAdd + 1);
        
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
}