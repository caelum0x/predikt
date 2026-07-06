// Typed viem bindings for the REAL contracts the web client calls. These are
// `as const` so viem fully types every read/write. They are a SUBSET of the
// real ABIs — only the functions/events the app actually uses — and are kept in
// lockstep with the full JSON ABIs vendored in ./abi/ (copied from each repo's
// forge `out/` directory).
//
// Real sources (NO Solidity is written/wrapped here — these call the real,
// already-built contracts directly):
//   ./abi/UmaCtfAdapter.json  — Polymarket UmaCtfAdapter (predikt-contracts/uma-ctf-adapter/out)
//   ./abi/CTFExchange.json    — Polymarket CTF Exchange   (predikt-contracts/ctf-exchange/out)
//   ./abi/ConditionalTokens.json — Gnosis CTF (already deployed on Polygon)
//   ./abi/ERC20.json          — USDC / ERC-20 (already deployed on Polygon)
//
// The full JSON artifacts are also re-exported below for reference/verification.

import UmaCtfAdapterArtifact from './abi/UmaCtfAdapter.json'
import CTFExchangeArtifact from './abi/CTFExchange.json'
import ConditionalTokensArtifact from './abi/ConditionalTokens.json'
import Erc20Artifact from './abi/ERC20.json'
import FixedProductMarketMakerArtifact from './abi/FixedProductMarketMaker.json'
import FpmmDeterministicFactoryArtifact from './abi/FPMMDeterministicFactory.json'

/** Full, real JSON ABIs (runtime values) copied from the vendored repos. */
export const umaCtfAdapterJsonAbi = UmaCtfAdapterArtifact.abi
export const ctfExchangeJsonAbi = CTFExchangeArtifact.abi
export const conditionalTokensJsonAbi = ConditionalTokensArtifact.abi
export const erc20JsonAbi = Erc20Artifact.abi
/** Predikt's own FPMM build output (predikt-contracts/fpmm/out). */
export const fixedProductMarketMakerJsonAbi = FixedProductMarketMakerArtifact.abi
export const fpmmDeterministicFactoryJsonAbi =
  FpmmDeterministicFactoryArtifact.abi

// --------------------------------------------------------------------------- //
//  UmaCtfAdapter — trustless UMA settlement (initialize / resolve / reads)     //
// --------------------------------------------------------------------------- //

export const umaAdapterAbi = [
  {
    type: 'function',
    name: 'initialize',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'ancillaryData', type: 'bytes' },
      { name: 'rewardToken', type: 'address' },
      { name: 'reward', type: 'uint256' },
      { name: 'proposalBond', type: 'uint256' },
      { name: 'liveness', type: 'uint256' },
    ],
    outputs: [{ name: 'questionID', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'ready',
    stateMutability: 'view',
    inputs: [{ name: 'questionID', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'resolve',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'questionID', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isInitialized',
    stateMutability: 'view',
    inputs: [{ name: 'questionID', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getExpectedPayouts',
    stateMutability: 'view',
    inputs: [{ name: 'questionID', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'ctf',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getQuestion',
    stateMutability: 'view',
    inputs: [{ name: 'questionID', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'requestTimestamp', type: 'uint256' },
          { name: 'reward', type: 'uint256' },
          { name: 'proposalBond', type: 'uint256' },
          { name: 'liveness', type: 'uint256' },
          { name: 'manualResolutionTimestamp', type: 'uint256' },
          { name: 'resolved', type: 'bool' },
          { name: 'paused', type: 'bool' },
          { name: 'reset', type: 'bool' },
          { name: 'refund', type: 'bool' },
          { name: 'rewardToken', type: 'address' },
          { name: 'creator', type: 'address' },
          { name: 'ancillaryData', type: 'bytes' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'QuestionInitialized',
    inputs: [
      { name: 'questionID', type: 'bytes32', indexed: true },
      { name: 'requestTimestamp', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'ancillaryData', type: 'bytes', indexed: false },
      { name: 'rewardToken', type: 'address', indexed: false },
      { name: 'reward', type: 'uint256', indexed: false },
      { name: 'proposalBond', type: 'uint256', indexed: false },
    ],
  },
] as const

// --------------------------------------------------------------------------- //
//  CTF Exchange — trading (fill signed orders / cancel / register token / reads) //
// --------------------------------------------------------------------------- //

/** Order side: 0 == BUY, 1 == SELL (matches enum Side). */
export const ORDER_SIDE = { BUY: 0, SELL: 1 } as const
/** Signature type: 0 == EOA (matches enum SignatureType). */
export const SIGNATURE_TYPE = { EOA: 0, POLY_PROXY: 1, POLY_GNOSIS_SAFE: 2 } as const

/** viem tuple components for the exchange `Order` struct. */
const ORDER_COMPONENTS = [
  { name: 'salt', type: 'uint256' },
  { name: 'maker', type: 'address' },
  { name: 'signer', type: 'address' },
  { name: 'taker', type: 'address' },
  { name: 'tokenId', type: 'uint256' },
  { name: 'makerAmount', type: 'uint256' },
  { name: 'takerAmount', type: 'uint256' },
  { name: 'expiration', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'feeRateBps', type: 'uint256' },
  { name: 'side', type: 'uint8' },
  { name: 'signatureType', type: 'uint8' },
  { name: 'signature', type: 'bytes' },
] as const

export const ctfExchangeAbi = [
  {
    type: 'function',
    name: 'fillOrder',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'order', type: 'tuple', components: ORDER_COMPONENTS },
      { name: 'fillAmount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'fillOrders',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orders', type: 'tuple[]', components: ORDER_COMPONENTS },
      { name: 'fillAmounts', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelOrder',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'order', type: 'tuple', components: ORDER_COMPONENTS }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'registerToken',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'uint256' },
      { name: 'complement', type: 'uint256' },
      { name: 'conditionId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'hashOrder',
    stateMutability: 'view',
    inputs: [{ name: 'order', type: 'tuple', components: ORDER_COMPONENTS }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'validateOrder',
    stateMutability: 'view',
    inputs: [{ name: 'order', type: 'tuple', components: ORDER_COMPONENTS }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getOrderStatus',
    stateMutability: 'view',
    inputs: [{ name: 'orderHash', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'isFilledOrCancelled', type: 'bool' },
          { name: 'remaining', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getComplement',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getConditionId',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getCollateral',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getCtf',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'isOperator',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

// --------------------------------------------------------------------------- //
//  Gnosis ConditionalTokens — split / merge / redeem / positions / payouts     //
// --------------------------------------------------------------------------- //

export const conditionalTokensAbi = [
  {
    type: 'function',
    name: 'splitPosition',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'partition', type: 'uint256[]' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'mergePositions',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'partition', type: 'uint256[]' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'redeemPositions',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'indexSets', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'positionId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'isApprovedForAll',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'setApprovalForAll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'payoutDenominator',
    stateMutability: 'view',
    inputs: [{ name: 'conditionId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'payoutNumerators',
    stateMutability: 'view',
    inputs: [
      { name: 'conditionId', type: 'bytes32' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getConditionId',
    stateMutability: 'pure',
    inputs: [
      { name: 'oracle', type: 'address' },
      { name: 'questionId', type: 'bytes32' },
      { name: 'outcomeSlotCount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getCollectionId',
    stateMutability: 'view',
    inputs: [
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'indexSet', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getPositionId',
    stateMutability: 'pure',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'collectionId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getOutcomeSlotCount',
    stateMutability: 'view',
    inputs: [{ name: 'conditionId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// --------------------------------------------------------------------------- //
//  ERC-20 (USDC)                                                               //
// --------------------------------------------------------------------------- //

export const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

// --------------------------------------------------------------------------- //
//  FixedProductMarketMaker — Predikt's AMM (Gnosis-derived, pricing UNCHANGED) //
//  Deployed as a standalone contract (LGPL-3.0); the app calls it via ABI.     //
//  See predikt-contracts/fpmm (NOTICE/LICENSE). outcomeIndex 0 == YES (indexSet //
//  1 << 0 == 1), outcomeIndex 1 == NO (indexSet 1 << 1 == 2) — matching the CTF //
//  position-id derivation in ./market.ts (YES=indexSet 1, NO=indexSet 2).       //
// --------------------------------------------------------------------------- //

export const fpmmAbi = [
  {
    type: 'function',
    name: 'calcBuyAmount',
    stateMutability: 'view',
    inputs: [
      { name: 'investmentAmount', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'calcSellAmount',
    stateMutability: 'view',
    inputs: [
      { name: 'returnAmount', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
    ],
    outputs: [{ name: 'outcomeTokenSellAmount', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'investmentAmount', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
      { name: 'minOutcomeTokensToBuy', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'sell',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'returnAmount', type: 'uint256' },
      { name: 'outcomeIndex', type: 'uint256' },
      { name: 'maxOutcomeTokensToSell', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'addFunding',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'addedFunds', type: 'uint256' },
      { name: 'distributionHint', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'removeFunding',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'sharesToBurn', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'fee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'conditionalTokens',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'collateralToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// --------------------------------------------------------------------------- //
//  FPMMDeterministicFactory — creates + funds FPMM clones (create2).           //
//  We use the FixedProductMarketMakerCreation event to discover a pool by its  //
//  conditionId (the event carries conditionIds + collateral in its data).      //
// --------------------------------------------------------------------------- //

export const fpmmFactoryAbi = [
  {
    type: 'function',
    name: 'create2FixedProductMarketMaker',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'saltNonce', type: 'uint256' },
      { name: 'conditionalTokens', type: 'address' },
      { name: 'collateralToken', type: 'address' },
      { name: 'conditionIds', type: 'bytes32[]' },
      { name: 'fee', type: 'uint256' },
      { name: 'initialFunds', type: 'uint256' },
      { name: 'distributionHint', type: 'uint256[]' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'FixedProductMarketMakerCreation',
    inputs: [
      { name: 'creator', type: 'address', indexed: true },
      { name: 'fixedProductMarketMaker', type: 'address', indexed: false },
      { name: 'conditionalTokens', type: 'address', indexed: false },
      { name: 'collateralToken', type: 'address', indexed: false },
      { name: 'conditionIds', type: 'bytes32[]', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
] as const
