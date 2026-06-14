// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PalmOS ERC-8004 Identity Registry
/// @notice A minimal-but-faithful ERC-8004 *trustless agent identity* registry. Each agent is a
///         soulbound ERC-721 whose tokenURI is the agent card (name, functionalities, service
///         endpoints, payment address). `register` mints the caller an identity NFT. Identity is
///         non-transferable because it represents *which agent this is*, not a tradable asset —
///         the common soulbound pattern for on-chain identity.
///
///         Self-contained (no imports) so it compiles with a single solc invocation and verifies
///         on the Mantle Sepolia explorer as a single flattened source — no remappings.
contract IdentityRegistry {
    string public constant name = "PalmOS Agent Identity";
    string public constant symbol = "PALMID";

    uint256 private _nextId = 1;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => string) private _tokenURIs;

    /// @notice agentId owned by an address (0 == not registered). Enables idempotent minting.
    mapping(address => uint256) public agentIdOf;

    // ERC-721 (Transfer from address(0) on mint is what NFT indexers key on).
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    // ERC-8004 identity lifecycle.
    event Registered(uint256 indexed agentId, address indexed owner, string agentCardURI);
    event AgentCardUpdated(uint256 indexed agentId, string agentCardURI);

    /// @notice Mint the caller a soulbound agent-identity NFT. One identity per address.
    function register(string calldata agentCardURI) external returns (uint256 agentId) {
        require(agentIdOf[msg.sender] == 0, "already registered");
        agentId = _nextId++;
        _owners[agentId] = msg.sender;
        _balances[msg.sender] += 1;
        _tokenURIs[agentId] = agentCardURI;
        agentIdOf[msg.sender] = agentId;
        emit Transfer(address(0), msg.sender, agentId);
        emit Registered(agentId, msg.sender, agentCardURI);
    }

    /// @notice Update the agent card for an identity you own (capabilities can evolve).
    function setAgentCard(uint256 agentId, string calldata agentCardURI) external {
        require(_owners[agentId] == msg.sender, "not owner");
        _tokenURIs[agentId] = agentCardURI;
        emit AgentCardUpdated(agentId, agentCardURI);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "nonexistent token");
        return owner;
    }

    function balanceOf(address owner) external view returns (uint256) {
        require(owner != address(0), "zero address");
        return _balances[owner];
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "nonexistent token");
        return _tokenURIs[tokenId];
    }

    function totalSupply() external view returns (uint256) {
        return _nextId - 1;
    }

    /// @dev ERC-165: advertises ERC-721 + Metadata so explorers index this as an NFT collection.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC-165
            interfaceId == 0x80ac58cd || // ERC-721
            interfaceId == 0x5b5e139f; // ERC-721 Metadata
    }
}
