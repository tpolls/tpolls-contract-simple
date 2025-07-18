const { Blockchain, SandboxContract, TreasuryContract } = require("@ton/sandbox");
const { toNano, Address } = require("@ton/core");
const { TPollsDapp } = require("../build/TPollsDapp_TPollsDapp");

describe("TPollsDapp", () => {
    let blockchain;
    let deployer;
    let contract;
    let user1;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury("deployer");
        user1 = await blockchain.treasury("user1");

        contract = blockchain.openContract(await TPollsDapp.fromInit(deployer.address));

        const deployResult = await contract.send(
            deployer.getSender(),
            {
                value: toNano("0.05"),
            },
            {
                $$type: "Deploy",
                queryId: 0n,
            }
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: contract.address,
            deploy: true,
            success: true,
        });
    });

    it("should deploy successfully", async () => {
        // Contract should be deployed successfully in beforeEach
    });

    it("should create a poll", async () => {
        const result = await contract.send(
            user1.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "CreatePoll",
            }
        );

        expect(result.transactions).toHaveTransaction({
            from: user1.address,
            to: contract.address,
            success: true,
        });

        const pollData = await contract.getPoll(1n);
        expect(pollData).toBeDefined();
        expect(pollData.pollId).toBe(1n);
        expect(pollData.creator.toString()).toBe(user1.address.toString());
        
        const pollCount = await contract.getPollCount();
        expect(pollCount).toBe(1n);
    });

    it("should allow voting on a poll", async () => {
        const pollId = 1n;
        const optionIndex = 0n;

        // Create poll first
        await contract.send(
            user1.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "CreatePoll",
            }
        );

        // Vote on poll
        const voteResult = await contract.send(
            user1.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "Vote",
                pollId: pollId,
                optionIndex: optionIndex,
            }
        );

        expect(voteResult.transactions).toHaveTransaction({
            from: user1.address,
            to: contract.address,
            success: true,
        });

        const results = await contract.getPollResults(pollId);
        expect(results).toBeDefined();
        expect(results.get(optionIndex)).toBe(1n);
    });

    it("should accumulate votes correctly", async () => {
        const pollId = 1n;
        const optionIndex = 0n;

        // Create poll
        await contract.send(
            user1.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "CreatePoll",
            }
        );

        // Vote multiple times
        for (let i = 0; i < 3; i++) {
            await contract.send(
                user1.getSender(),
                {
                    value: toNano("0.01"),
                },
                {
                    $$type: "Vote",
                    pollId: pollId,
                    optionIndex: optionIndex,
                }
            );
        }

        const results = await contract.getPollResults(pollId);
        expect(results.get(optionIndex)).toBe(3n);
    });

    it("should handle multiple options", async () => {
        const pollId = 1n;

        // Create poll
        await contract.send(
            user1.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "CreatePoll",
            }
        );

        // Vote on different options
        await contract.send(
            user1.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "Vote",
                pollId: pollId,
                optionIndex: 0n,
            }
        );

        await contract.send(
            user1.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "Vote",
                pollId: pollId,
                optionIndex: 1n,
            }
        );

        await contract.send(
            user1.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "Vote",
                pollId: pollId,
                optionIndex: 0n,
            }
        );

        const results = await contract.getPollResults(pollId);
        expect(results.get(0n)).toBe(2n);
        expect(results.get(1n)).toBe(1n);
    });

    it("should get all polls", async () => {
        // Create multiple polls
        await contract.send(
            user1.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "CreatePoll",
            }
        );

        await contract.send(
            deployer.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "CreatePoll",
            }
        );

        const allPolls = await contract.getAllPolls();
        expect(allPolls).toBeDefined();
        
        const poll1 = allPolls.get(1n);
        const poll2 = allPolls.get(2n);
        
        expect(poll1).toBeDefined();
        expect(poll2).toBeDefined();
        expect(poll1.creator.toString()).toBe(user1.address.toString());
        expect(poll2.creator.toString()).toBe(deployer.address.toString());
        
        const pollCount = await contract.getPollCount();
        expect(pollCount).toBe(2n);
    });

    it("should track poll count correctly", async () => {
        let pollCount = await contract.getPollCount();
        expect(pollCount).toBe(0n);

        // Create first poll
        await contract.send(
            user1.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "CreatePoll",
            }
        );

        pollCount = await contract.getPollCount();
        expect(pollCount).toBe(1n);

        // Create second poll
        await contract.send(
            deployer.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "CreatePoll",
            }
        );

        pollCount = await contract.getPollCount();
        expect(pollCount).toBe(2n);
    });

    it("should get poll creator correctly", async () => {
        await contract.send(
            user1.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "CreatePoll",
            }
        );

        const creator = await contract.getPollCreator(1n);
        expect(creator).toBeDefined();
        expect(creator.toString()).toBe(user1.address.toString());
    });

    it("should handle complex voting scenario", async () => {
        // Create a poll
        await contract.send(
            user1.getSender(),
            {
                value: toNano("0.01"),
            },
            {
                $$type: "CreatePoll",
            }
        );

        // Multiple users vote on different options
        const user2 = await blockchain.treasury("user2");
        const user3 = await blockchain.treasury("user3");

        // User1 votes for option 0 (twice)
        await contract.send(user1.getSender(), { value: toNano("0.01") }, { $$type: "Vote", pollId: 1n, optionIndex: 0n });
        await contract.send(user1.getSender(), { value: toNano("0.01") }, { $$type: "Vote", pollId: 1n, optionIndex: 0n });

        // User2 votes for option 1
        await contract.send(user2.getSender(), { value: toNano("0.01") }, { $$type: "Vote", pollId: 1n, optionIndex: 1n });

        // User3 votes for option 2
        await contract.send(user3.getSender(), { value: toNano("0.01") }, { $$type: "Vote", pollId: 1n, optionIndex: 2n });

        // Check results
        const results = await contract.getPollResults(1n);
        expect(results.get(0n)).toBe(2n); // Option 0: 2 votes
        expect(results.get(1n)).toBe(1n); // Option 1: 1 vote
        expect(results.get(2n)).toBe(1n); // Option 2: 1 vote

        // Verify poll data through getAllPolls
        const allPolls = await contract.getAllPolls();
        const poll = allPolls.get(1n);
        expect(poll.pollId).toBe(1n);
        expect(poll.creator.toString()).toBe(user1.address.toString());
        expect(poll.results.get(0n)).toBe(2n);
        expect(poll.results.get(1n)).toBe(1n);
        expect(poll.results.get(2n)).toBe(1n);
    });
});