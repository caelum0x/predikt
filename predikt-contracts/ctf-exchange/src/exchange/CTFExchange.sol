// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import { Auth } from "./mixins/Auth.sol";
import { Fees } from "./mixins/Fees.sol";
import { Assets } from "./mixins/Assets.sol";
import { Hashing } from "./mixins/Hashing.sol";
import { Trading } from "./mixins/Trading.sol";
import { Registry } from "./mixins/Registry.sol";
import { Pausable } from "./mixins/Pausable.sol";
import { Signatures } from "./mixins/Signatures.sol";
import { NonceManager } from "./mixins/NonceManager.sol";
import { AssetOperations } from "./mixins/AssetOperations.sol";

import { BaseExchange } from "./BaseExchange.sol";

import { Order } from "./libraries/OrderStructs.sol";

/// @title CTF Exchange
/// @notice Predikt trading layer. Implements non-custodial logic for trading CTF outcome tokens.
///         Part of Predikt's on-chain layer (MIT). Orders are built/signed with the predikt-orders SDK.
/// @author Predikt (originally authored by Polymarket; adopted as Predikt first-class code)
/// @dev The EIP-712 domain name below ("Polymarket CTF Exchange", version "1") is a load-bearing
///      on-chain constant that deployed contracts and off-chain order signers depend on. It MUST
///      NOT be changed — altering it would invalidate every existing order signature.
contract CTFExchange is
    BaseExchange,
    Auth,
    Assets,
    Fees,
    Pausable,
    AssetOperations,
    Hashing("Polymarket CTF Exchange", "1"),
    NonceManager,
    Registry,
    Signatures,
    Trading
{
    constructor(address _collateral, address _ctf, address _proxyFactory, address _safeFactory)
        Assets(_collateral, _ctf)
        Signatures(_proxyFactory, _safeFactory)
    { }

    /*//////////////////////////////////////////////////////////////
                        PAUSE
    //////////////////////////////////////////////////////////////*/

    /// @notice Pause trading on the Exchange
    function pauseTrading() external onlyAdmin {
        _pauseTrading();
    }

    /// @notice Unpause trading on the Exchange
    function unpauseTrading() external onlyAdmin {
        _unpauseTrading();
    }

    /*//////////////////////////////////////////////////////////////
                        TRADING
    //////////////////////////////////////////////////////////////*/

    /// @notice Fills an order
    /// @param order        - The order to be filled
    /// @param fillAmount   - The amount to be filled, always in terms of the maker amount
    function fillOrder(Order memory order, uint256 fillAmount) external nonReentrant onlyOperator notPaused {
        _fillOrder(order, fillAmount, msg.sender);
    }

    /// @notice Fills a set of orders
    /// @param orders       - The order to be filled
    /// @param fillAmounts  - The amounts to be filled, always in terms of the maker amount
    function fillOrders(Order[] memory orders, uint256[] memory fillAmounts)
        external
        nonReentrant
        onlyOperator
        notPaused
    {
        _fillOrders(orders, fillAmounts, msg.sender);
    }

    /// @notice Matches a taker order against a list of maker orders
    /// @param takerOrder       - The active order to be matched
    /// @param makerOrders      - The array of maker orders to be matched against the active order
    /// @param takerFillAmount  - The amount to fill on the taker order, always in terms of the maker amount
    /// @param makerFillAmounts - The array of amounts to fill on the maker orders, always in terms of the maker amount
    function matchOrders(
        Order memory takerOrder,
        Order[] memory makerOrders,
        uint256 takerFillAmount,
        uint256[] memory makerFillAmounts
    ) external nonReentrant onlyOperator notPaused {
        _matchOrders(takerOrder, makerOrders, takerFillAmount, makerFillAmounts);
    }

    /*//////////////////////////////////////////////////////////////
                        CONFIGURATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Sets a new Proxy Wallet factory for the Exchange
    /// @param _newProxyFactory - The new Proxy Wallet factory
    function setProxyFactory(address _newProxyFactory) external onlyAdmin {
        _setProxyFactory(_newProxyFactory);
    }

    /// @notice Sets a new safe factory for the Exchange
    /// @param _newSafeFactory  - The new Safe wallet factory
    function setSafeFactory(address _newSafeFactory) external onlyAdmin {
        _setSafeFactory(_newSafeFactory);
    }

    /// @notice Registers a tokenId, its complement and its conditionId for trading on the Exchange
    /// @param token        - The tokenId being registered
    /// @param complement   - The complement of the tokenId
    /// @param conditionId  - The CTF conditionId
    function registerToken(uint256 token, uint256 complement, bytes32 conditionId) external onlyAdmin {
        _registerToken(token, complement, conditionId);
    }
}
