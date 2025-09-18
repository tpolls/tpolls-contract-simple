// TON Polls Proxy Contract
// This proxy contract maintains a stable address while allowing upgrades
// to the implementation contract through message forwarding

struct UpgradeImplementation {
    newImplementation: address,
}

global owner: address
global implementation: address

// Initialize proxy with owner and initial implementation
fun init(ownerAddr: address, implementationAddr: address) {
    owner = ownerAddr
    implementation = implementationAddr
}

// Parse sender address from incoming message
fun parseSenderAddress(msgFull: cell): address {
    val cs: slice = msgFull.begin_parse()
    cs~load_uint(4) // flags
    return cs~load_msg_addr()
}

// Handle upgrade implementation message (owner only)
fun handleUpgradeImplementation(msg: UpgradeImplementation, sender: address) {
    throw_unless(100, sender == owner) // "Only owner can upgrade"
    implementation = msg.newImplementation
}

// Forward message to implementation contract
fun forwardToImplementation(msgFull: cell, msgBody: slice, msgValue: int, sender: address) {
    // Create message body with original sender prepended
    val forwardedBody: cell = beginCell()
        .storeAddress(sender)  // Store original sender
        .storeSlice(msgBody)   // Store original message body
        .endCell()

    // Forward message to implementation
    val msg: cell = beginCell()
        .storeUint(0x18, 6)                    // Message flags
        .storeAddress(implementation)          // Destination: implementation contract
        .storeCoins(msgValue - 10000000)      // Forward value minus gas reserve (0.01 TON)
        .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1) // Extra message bits
        .storeRef(forwardedBody)               // Message body as reference
        .endCell()

    send_raw_message(msg, 1) // Send with ignore errors flag
}

// Main message handler
() recv_internal(int balance, int msg_value, cell in_msg_full, slice in_msg_body) impure {
    // Don't process bounce messages
    val cs: slice = in_msg_full.begin_parse()
    val flags: int = cs~load_uint(4)
    if (flags & 1) {
        return ()
    }

    val sender: address = parseSenderAddress(in_msg_full)

    // Check if there's a message body with opcode
    if (in_msg_body.slice_bits() >= 32) {
        val op: int = in_msg_body~load_uint(32)

        // Handle upgrade message (owner only)
        if (op == 0x555047524144) { // "UPGRAD" - upgrade opcode
            val upgradeMsg: UpgradeImplementation = in_msg_body~load_upgrade_implementation()
            handleUpgradeImplementation(upgradeMsg, sender)
            return ()
        }
    }

    // For all other messages, forward to implementation
    // Reset slice to include the opcode we just read
    val fullBody: slice = in_msg_body
    forwardToImplementation(in_msg_full, fullBody, msg_value, sender)
}

// Getter functions
get fun getImplementation(): address {
    return implementation
}

get fun getOwner(): address {
    return owner
}

// Load functions for message parsing
fun load_upgrade_implementation(slice s): UpgradeImplementation {
    return UpgradeImplementation {
        newImplementation: s~load_msg_addr()
    }
}