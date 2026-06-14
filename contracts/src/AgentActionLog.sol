// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PalmOS Agent Action Log
/// @notice An ERC-8004-style validation/reputation log: an on-chain benchmark of *governed* agent
///         behavior. EVERY policy decision and its outcome is recorded as one cheap, indexable
///         event — INCLUDING denied/blocked actions, which is the governance money-shot ("the
///         agent was stopped on-chain"). `solanaSignature` is the cross-chain link tying a decision
///         to its Byreal/Solana settlement. This is PalmOS's audit/governance thesis living on
///         Mantle: the hackathon's "on-chain benchmarking of AI", not a bolt-on.
contract AgentActionLog {
    /// @notice Monotonic count of all decisions ever recorded (also used as the per-record seq).
    uint256 public recordCount;

    /// @param agentId         the ERC-8004 IdentityRegistry token id of the acting agent
    /// @param actionId        keccak256 of the PalmOS actionRequestId (stable cross-system key)
    /// @param seq             global monotonic sequence number
    /// @param kind            asset.swap | asset.liquidity
    /// @param verdict         auto_approved | approval_required | denied
    /// @param outcome         executed | approval_pending | blocked | failed
    /// @param solanaSignature Solana settlement signature (empty when not executed)
    /// @param amount          informational notional/base-unit amount
    /// @param detail          freeform context (asset pair, policy reason code, etc.)
    event DecisionRecorded(
        uint256 indexed agentId,
        bytes32 indexed actionId,
        uint256 indexed seq,
        string kind,
        string verdict,
        string outcome,
        string solanaSignature,
        uint256 amount,
        string detail
    );

    /// @notice Record one governed decision + outcome. Anyone can call, but in PalmOS the caller is
    ///         the agent's own OWS EVM account — so msg.sender == the agent that made the decision.
    function recordDecision(
        uint256 agentId,
        bytes32 actionId,
        string calldata kind,
        string calldata verdict,
        string calldata outcome,
        string calldata solanaSignature,
        uint256 amount,
        string calldata detail
    ) external returns (uint256 seq) {
        seq = ++recordCount;
        emit DecisionRecorded(
            agentId,
            actionId,
            seq,
            kind,
            verdict,
            outcome,
            solanaSignature,
            amount,
            detail
        );
    }
}
