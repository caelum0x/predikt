# Predikt on-chain layer — drives all three packages as one workspace.
# settlement = uma-ctf-adapter, trading = ctf-exchange, orders = clob-client (@predikt/orders)

.PHONY: build test build-settlement test-settlement build-trading build-orders test-orders

# Build every Solidity package.
build: build-settlement build-trading

# Test the workspace. Settlement carries the on-chain test suite (61+ tests).
test: test-settlement

build-settlement:
	cd uma-ctf-adapter && forge build

test-settlement:
	cd uma-ctf-adapter && forge test

build-trading:
	cd ctf-exchange && forge build

# The @predikt/orders SDK (order building + EIP-712 signing).
build-orders:
	cd clob-client && pnpm build

test-orders:
	cd clob-client && pnpm typecheck
