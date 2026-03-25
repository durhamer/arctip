.PHONY: build test test-gas clean fmt snapshot deploy deploy-registry deploy-tipjar \
        register-creator tip verify help

-include .env
export

RPC        := $(ARC_TESTNET_RPC_URL)
PRIVATE_KEY := $(PRIVATE_KEY)
REGISTRY   := $(CREATOR_REGISTRY_ADDRESS)
TIPJAR     := $(TIP_JAR_ADDRESS)
ARC_USDC   := 0x3600000000000000000000000000000000000000

# ── Build ─────────────────────────────────────────────────────────────────────

build:        ## Compile all contracts
	forge build

test:         ## Run all tests
	forge test -vvv

test-gas:     ## Run tests with gas reporting
	forge test --gas-report

clean:        ## Remove build artifacts
	forge clean

fmt:          ## Format Solidity source
	forge fmt

snapshot:     ## Generate gas snapshot
	forge snapshot

# ── Deploy ────────────────────────────────────────────────────────────────────

deploy:       ## Deploy CreatorRegistry + TipJar to Arc Testnet
	forge script script/Deploy.s.sol:DeployArcTip \
		--rpc-url $(RPC) \
		--private-key $(PRIVATE_KEY) \
		--broadcast \
		-vvvv

deploy-registry: ## Deploy only CreatorRegistry
	forge create src/CreatorRegistry.sol:CreatorRegistry \
		--rpc-url $(RPC) \
		--private-key $(PRIVATE_KEY)

deploy-tipjar: ## Deploy only TipJar (set REGISTRY first)
	forge create src/TipJar.sol:TipJar \
		--rpc-url $(RPC) \
		--private-key $(PRIVATE_KEY) \
		--constructor-args $(ARC_USDC) $(REGISTRY) 100

# ── Contract interaction via cast ─────────────────────────────────────────────

register-creator: ## Register as creator: make register-creator HANDLE=@you URL=https://…
	cast send $(REGISTRY) \
		"register(string,string)" "$(HANDLE)" "$(URL)" \
		--rpc-url $(RPC) \
		--private-key $(PRIVATE_KEY)

tip: ## Send a tip: make tip CREATOR=0x… AMOUNT=1000000 MSG="gm"
	cast send $(ARC_USDC) \
		"approve(address,uint256)" $(TIPJAR) $(AMOUNT) \
		--rpc-url $(RPC) \
		--private-key $(PRIVATE_KEY)
	cast send $(TIPJAR) \
		"tip(address,uint256,string)" $(CREATOR) $(AMOUNT) "$(MSG)" \
		--rpc-url $(RPC) \
		--private-key $(PRIVATE_KEY)

is-registered: ## Check if ADDRESS is registered: make is-registered ADDRESS=0x…
	cast call $(REGISTRY) "isRegistered(address)(bool)" $(ADDRESS) --rpc-url $(RPC)

creator-info: ## Get creator info: make creator-info ADDRESS=0x…
	cast call $(REGISTRY) "getCreator(address)((string,string,bool,uint256))" $(ADDRESS) \
		--rpc-url $(RPC)

tips-received: ## Check total tips for ADDRESS
	cast call $(TIPJAR) "totalTipsReceived(address)(uint256)" $(ADDRESS) --rpc-url $(RPC)

fee-bps: ## Show current platform fee in bps
	cast call $(TIPJAR) "feeBps()(uint256)" --rpc-url $(RPC)

preview-tip: ## Preview tip breakdown: make preview-tip AMOUNT=1000000
	cast call $(TIPJAR) "previewTip(uint256)(uint256,uint256)" $(AMOUNT) --rpc-url $(RPC)

# ── Wallet / chain utils ──────────────────────────────────────────────────────

wallet-new:   ## Generate a new wallet (for testing only)
	cast wallet new

chain-id:     ## Print Arc Testnet chain ID
	cast chain-id --rpc-url $(RPC)

block:        ## Print latest block number
	cast block-number --rpc-url $(RPC)

usdc-balance: ## Check USDC balance: make usdc-balance ADDRESS=0x…
	cast call $(ARC_USDC) "balanceOf(address)(uint256)" $(ADDRESS) --rpc-url $(RPC)

# ── Verification ──────────────────────────────────────────────────────────────

verify:       ## Verify contracts on Arcscan (set REGISTRY and TIPJAR first)
	forge verify-contract $(REGISTRY) src/CreatorRegistry.sol:CreatorRegistry \
		--chain-id 5042002 \
		--etherscan-api-key $(ARCSCAN_API_KEY) \
		--verifier-url https://testnet.arcscan.app/api
	forge verify-contract $(TIPJAR) src/TipJar.sol:TipJar \
		--chain-id 5042002 \
		--etherscan-api-key $(ARCSCAN_API_KEY) \
		--verifier-url https://testnet.arcscan.app/api \
		--constructor-args $$(cast abi-encode "constructor(address,address,uint256)" $(ARC_USDC) $(REGISTRY) 100)

help:         ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
