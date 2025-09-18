// Simple TPollsDapp contract in Tolk - Basic version to test compilation

struct Poll {
    pollId: int;
    totalVoters: int;
}

global pollCount: int;

() recv_internal() impure {

}

get fun getPollCount(): int {
    return pollCount;
}