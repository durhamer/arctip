// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title CreatorRegistry
/// @notice Allows content creators to register their on-chain identity with a handle and URL
contract CreatorRegistry {
    struct Creator {
        string handle;   // e.g. "@alice"
        string url;      // e.g. "https://twitter.com/alice"
        bool registered;
        uint256 registeredAt;
    }

    // address -> Creator info
    mapping(address => Creator) private creators;

    // handle (lowercase) -> address, for reverse lookup
    mapping(bytes32 => address) private handleToAddress;

    event CreatorRegistered(address indexed creator, string handle, string url);
    event CreatorUpdated(address indexed creator, string handle, string url);

    error HandleTaken(string handle);
    error NotRegistered();
    error EmptyHandle();
    error EmptyUrl();

    modifier onlyRegistered() {
        if (!creators[msg.sender].registered) revert NotRegistered();
        _;
    }

    /// @notice Register as a creator
    /// @param handle  Short username, e.g. "@alice"
    /// @param url     Profile URL pointing to the creator's page
    function register(string calldata handle, string calldata url) external {
        if (bytes(handle).length == 0) revert EmptyHandle();
        if (bytes(url).length == 0) revert EmptyUrl();

        bytes32 key = _handleKey(handle);
        address existing = handleToAddress[key];
        if (existing != address(0) && existing != msg.sender) revert HandleTaken(handle);

        // If already registered, free the old handle key
        if (creators[msg.sender].registered) {
            bytes32 oldKey = _handleKey(creators[msg.sender].handle);
            if (oldKey != key) delete handleToAddress[oldKey];
        }

        creators[msg.sender] = Creator({
            handle: handle,
            url: url,
            registered: true,
            registeredAt: block.timestamp
        });
        handleToAddress[key] = msg.sender;

        if (existing == msg.sender) {
            emit CreatorUpdated(msg.sender, handle, url);
        } else {
            emit CreatorRegistered(msg.sender, handle, url);
        }
    }

    /// @notice Unregister and remove the creator record
    function unregister() external onlyRegistered {
        bytes32 key = _handleKey(creators[msg.sender].handle);
        delete handleToAddress[key];
        delete creators[msg.sender];
    }

    // ── View functions ────────────────────────────────────────────────────────

    function getCreator(address addr) external view returns (Creator memory) {
        return creators[addr];
    }

    function isRegistered(address addr) external view returns (bool) {
        return creators[addr].registered;
    }

    function getAddressByHandle(string calldata handle) external view returns (address) {
        return handleToAddress[_handleKey(handle)];
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// @dev Case-insensitive handle key
    function _handleKey(string memory handle) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_toLower(handle)));
    }

    function _toLower(string memory str) internal pure returns (string memory) {
        bytes memory bStr = bytes(str);
        bytes memory bLower = new bytes(bStr.length);
        for (uint256 i = 0; i < bStr.length; i++) {
            bLower[i] =
                (bStr[i] >= 0x41 && bStr[i] <= 0x5A) ? bytes1(uint8(bStr[i]) + 32) : bStr[i];
        }
        return string(bLower);
    }
}
