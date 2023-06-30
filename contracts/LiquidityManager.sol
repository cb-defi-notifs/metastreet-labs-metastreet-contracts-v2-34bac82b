// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "./interfaces/ILiquidity.sol";
import "./Tick.sol";

/**
 * @title LiquidityManager
 * @author MetaStreet Labs
 */
library LiquidityManager {
    using SafeCast for uint256;

    /**************************************************************************/
    /* Constants */
    /**************************************************************************/

    /**
     * @notice Tick limit spacing basis points (10%)
     */
    uint256 internal constant TICK_LIMIT_SPACING_BASIS_POINTS = 1000;

    /**
     * @notice Fixed point scale
     */
    uint256 internal constant FIXED_POINT_SCALE = 1e18;

    /**
     * @notice Basis points scale
     */
    uint256 internal constant BASIS_POINTS_SCALE = 10_000;

    /**
     * @notice Impaired price threshold (5%)
     */
    uint256 internal constant IMPAIRED_PRICE_THRESHOLD = 0.05 * 1e18;

    /**************************************************************************/
    /* Errors */
    /**************************************************************************/

    /**
     * @notice Insufficient liquidity
     */
    error InsufficientLiquidity();

    /**
     * @notice Inactive liquidity
     */
    error InactiveLiquidity();

    /**
     * @notice Insufficient tick spacing
     */
    error InsufficientTickSpacing();

    /**************************************************************************/
    /* Getters */
    /**************************************************************************/

    /**
     * @notice Get redemption available amount
     * @param liquidity Liquidity state
     * @param tick Tick
     * @param pending Redemption pending
     * @param index Redemption index
     * @param target Redemption target
     * @return Redeemed shares, redeemed amount
     */
    function redemptionAvailable(
        ILiquidity.Liquidity storage liquidity,
        uint128 tick,
        uint128 pending,
        uint128 index,
        uint128 target
    ) internal view returns (uint128, uint128) {
        ILiquidity.Node storage node = liquidity.nodes[tick];

        uint128 processedShares = 0;
        uint128 totalRedeemedShares = 0;
        uint128 totalRedeemedAmount = 0;

        for (; processedShares < target + pending; index++) {
            /* Look up the next fulfilled redemption */
            ILiquidity.FulfilledRedemption storage redemption = node.redemptions.fulfilled[index];
            if (index == node.redemptions.index) {
                /* Reached pending unfulfilled redemption */
                break;
            }

            processedShares += redemption.shares;
            if (processedShares <= target) {
                /* Have not reached the redemption queue position yet */
                continue;
            } else {
                /* Compute number of shares to redeem in range of this
                 * redemption batch */
                uint128 shares = (((processedShares > target + pending) ? pending : (processedShares - target))) -
                    totalRedeemedShares;
                /* Compute price of shares in this redemption batch */
                uint256 price = (redemption.amount * FIXED_POINT_SCALE) / redemption.shares;

                /* Accumulate redeemed shares and corresponding amount */
                totalRedeemedShares += shares;
                totalRedeemedAmount += Math.mulDiv(shares, price, FIXED_POINT_SCALE).toUint128();
            }
        }

        return (totalRedeemedShares, totalRedeemedAmount);
    }

    /**************************************************************************/
    /* Internal Helpers */
    /**************************************************************************/

    /**
     * @dev Check if tick is reserved
     * @param tick Tick
     * @return True if reserved, otherwise false
     */
    function _isReserved(uint128 tick) internal pure returns (bool) {
        return tick == 0 || tick == type(uint128).max;
    }

    /**
     * @dev Check if liquidity node is empty
     * @param node Liquidity node
     * @return True if empty, otherwise false
     */
    function _isEmpty(ILiquidity.Node storage node) internal view returns (bool) {
        return node.value == 0 && node.shares == 0 && node.available == 0 && node.pending == 0;
    }

    /**
     * @dev Check if liquidity node is active
     * @param node Liquidity node
     * @return True if active, otherwise false
     */
    function _isActive(ILiquidity.Node storage node) internal view returns (bool) {
        return node.prev != 0 || node.next != 0;
    }

    /**
     * @dev Check if liquidity node is impaired
     * @param node Liquidity node
     * @return True if impaired, otherwise false
     */
    function _isImpaired(ILiquidity.Node storage node) internal view returns (bool) {
        /* If there's shares, but insufficient value for a stable share price */
        return node.shares != 0 && node.value * FIXED_POINT_SCALE < node.shares * IMPAIRED_PRICE_THRESHOLD;
    }

    /**
     * @notice Instantiate liquidity
     * @param liquidity Liquidity state
     * @param tick Tick
     */
    function _instantiate(ILiquidity.Liquidity storage liquidity, ILiquidity.Node storage node, uint128 tick) internal {
        /* If node is active, do nothing */
        if (_isActive(node)) return;
        /* If node is inactive and not empty, revert */
        if (!_isEmpty(node)) revert InactiveLiquidity();

        /* Find prior node to new tick */
        uint128 prevTick = 0;
        ILiquidity.Node storage prevNode = liquidity.nodes[prevTick];
        while (prevNode.next < tick) {
            prevTick = prevNode.next;
            prevNode = liquidity.nodes[prevTick];
        }

        /* Decode limits from previous tick, new tick, and next tick */
        (uint256 prevLimit, , , ) = Tick.decode(prevTick);
        (uint256 newLimit, , , ) = Tick.decode(tick);
        (uint256 nextLimit, , , ) = Tick.decode(prevNode.next);

        /* Validate tick limit spacing */
        if (
            newLimit != prevLimit &&
            newLimit < (prevLimit * (BASIS_POINTS_SCALE + TICK_LIMIT_SPACING_BASIS_POINTS)) / BASIS_POINTS_SCALE
        ) revert InsufficientTickSpacing();
        if (
            newLimit != nextLimit &&
            nextLimit < (newLimit * (BASIS_POINTS_SCALE + TICK_LIMIT_SPACING_BASIS_POINTS)) / BASIS_POINTS_SCALE
        ) revert InsufficientTickSpacing();

        /* Link new node */
        node.prev = prevTick;
        node.next = prevNode.next;
        liquidity.nodes[prevNode.next].prev = tick;
        prevNode.next = tick;
    }

    /**
     * @dev Garbage collect an impaired or empty node, unlinking it from active
     * liquidity
     * @param liquidity Liquidity state
     * @param node Liquidity node
     */
    function _garbageCollect(ILiquidity.Liquidity storage liquidity, ILiquidity.Node storage node) internal {
        /* If node is not impaired and not empty, or already inactive, do nothing */
        if ((!_isImpaired(node) && !_isEmpty(node)) || !_isActive(node)) return;

        /* Make node inactive by unlinking it */
        liquidity.nodes[node.prev].next = node.next;
        liquidity.nodes[node.next].prev = node.prev;
        node.next = 0;
        node.prev = 0;
    }

    /**
     * @notice Process redemptions from available liquidity
     * @param liquidity Liquidity state
     * @param node Liquidity node
     */
    function _processRedemptions(ILiquidity.Liquidity storage liquidity, ILiquidity.Node storage node) internal {
        /* If there's no pending shares to redeem */
        if (node.redemptions.pending == 0) return;

        /* Compute redemption price */
        uint256 price = (node.value * FIXED_POINT_SCALE) / node.shares;

        if (price == 0) {
            /* If node has pending interest */
            if (node.pending != 0) return;

            /* If node is insolvent, redeem all shares for zero amount */
            uint128 shares = node.redemptions.pending;

            /* Record fulfilled redemption */
            node.redemptions.fulfilled[node.redemptions.index++] = ILiquidity.FulfilledRedemption({
                shares: shares,
                amount: 0
            });

            /* Update node state */
            node.shares -= shares;
            node.value = 0;
            node.available = 0;
            node.redemptions.pending = 0;

            return;
        } else {
            /* Node is solvent */

            /* If there's no cash to redeem from */
            if (node.available == 0) return;

            /* Redeem as many shares as possible and pending from available cash */
            uint128 shares = uint128(Math.min((node.available * FIXED_POINT_SCALE) / price, node.redemptions.pending));
            uint128 amount = Math.mulDiv(shares, price, FIXED_POINT_SCALE).toUint128();

            /* If there's insufficient cash to redeem non-zero pending shares
             * at current price */
            if (shares == 0) return;

            /* Record fulfilled redemption */
            node.redemptions.fulfilled[node.redemptions.index++] = ILiquidity.FulfilledRedemption({
                shares: shares,
                amount: amount
            });

            /* Update node state */
            node.shares -= shares;
            node.value -= amount;
            node.available -= amount;
            node.redemptions.pending -= shares;

            /* Garbage collect node if it is now empty */
            _garbageCollect(liquidity, node);

            return;
        }
    }

    /**************************************************************************/
    /* Primary API */
    /**************************************************************************/

    /**
     * @notice Initialize liquidity state
     * @param liquidity Liquidity state
     */
    function initialize(ILiquidity.Liquidity storage liquidity) internal {
        /* Liquidity state defaults to zero, but need to make head and tail nodes */
        liquidity.nodes[0].next = type(uint128).max;
        liquidity.nodes[type(uint128).max].prev = 0;
    }

    /**
     * @notice Deposit liquidity
     * @param liquidity Liquidity state
     * @param tick Tick
     * @param amount Amount
     * @return Number of shares
     */
    function deposit(ILiquidity.Liquidity storage liquidity, uint128 tick, uint128 amount) internal returns (uint128) {
        ILiquidity.Node storage node = liquidity.nodes[tick];

        /* If tick is reserved */
        if (_isReserved(tick)) revert InactiveLiquidity();

        /* Instantiate node, if necessary */
        _instantiate(liquidity, node, tick);

        /* Compute deposit price as current value + 50% of pending returns */
        uint256 price = node.shares == 0
            ? FIXED_POINT_SCALE
            : ((node.value + (node.available + node.pending - node.value) / 2) * FIXED_POINT_SCALE) / node.shares;
        uint128 shares = ((amount * FIXED_POINT_SCALE) / price).toUint128();

        node.value += amount;
        node.shares += shares;
        node.available += amount;

        /* Process any pending redemptions from available cash */
        _processRedemptions(liquidity, node);

        return shares;
    }

    /**
     * @notice Use liquidity from node
     * @param liquidity Liquidity state
     * @param tick Tick
     * @param used Used amount
     * @param pending Pending Amount
     */
    function use(ILiquidity.Liquidity storage liquidity, uint128 tick, uint128 used, uint128 pending) internal {
        ILiquidity.Node storage node = liquidity.nodes[tick];

        node.available -= used;
        node.pending += pending;
    }

    /**
     * @notice Restore liquidity and process pending redemptions
     * @param liquidity Liquidity state
     * @param tick Tick
     * @param used Used amount
     * @param pending Pending amount
     * @param restored Restored amount
     */
    function restore(
        ILiquidity.Liquidity storage liquidity,
        uint128 tick,
        uint128 used,
        uint128 pending,
        uint128 restored
    ) internal {
        ILiquidity.Node storage node = liquidity.nodes[tick];

        node.value = node.value - used + restored;
        node.available += restored;
        node.pending -= pending;

        /* Garbage collect node if it is now impaired */
        _garbageCollect(liquidity, node);

        /* Process any pending redemptions */
        _processRedemptions(liquidity, node);
    }

    /**
     * @notice Redeem liquidity
     * @param liquidity Liquidity state
     * @param tick Tick
     * @param shares Shares
     * @return Redemption index, Redemption target
     */
    function redeem(
        ILiquidity.Liquidity storage liquidity,
        uint128 tick,
        uint128 shares
    ) internal returns (uint128, uint128) {
        ILiquidity.Node storage node = liquidity.nodes[tick];

        /* Redemption from inactive liquidity nodes is allowed to facilitate
         * restoring garbage collected nodes */

        /* Snapshot redemption target */
        uint128 redemptionIndex = node.redemptions.index;
        uint128 redemptionTarget = node.redemptions.pending;

        /* Add shares to pending redemptions */
        node.redemptions.pending += shares;

        /* Initialize redemption record to save gas in loan callbacks */
        if (node.redemptions.fulfilled[redemptionIndex].shares != type(uint128).max) {
            node.redemptions.fulfilled[redemptionIndex] = ILiquidity.FulfilledRedemption({
                shares: type(uint128).max,
                amount: 0
            });
        }

        /* Process any pending redemptions from available cash */
        _processRedemptions(liquidity, node);

        return (redemptionIndex, redemptionTarget);
    }

    /**
     * @notice Source liquidity from nodes
     * @param liquidity Liquidity state
     * @param amount Amount
     * @param ticks Ticks to source from
     * @param multiplier Multiplier for amount
     * @param durationIndex Duration index for amount
     * @return Sourced liquidity nodes, count of nodes
     */
    function source(
        ILiquidity.Liquidity storage liquidity,
        uint256 amount,
        uint128[] calldata ticks,
        uint256 multiplier,
        uint256 durationIndex
    ) internal view returns (ILiquidity.NodeSource[] memory, uint16) {
        ILiquidity.NodeSource[] memory sources = new ILiquidity.NodeSource[](ticks.length);

        uint256 prevTick;
        uint256 taken;
        uint256 count;
        for (; count < ticks.length && taken != amount; count++) {
            uint128 tick = ticks[count];

            /* Validate tick and decode limit */
            uint256 limit = Tick.validate(tick, prevTick, durationIndex);

            /* Look up liquidity node */
            ILiquidity.Node storage node = liquidity.nodes[tick];

            /* Consume as much as possible up to the tick limit, amount available, and amount remaining */
            uint128 take = uint128(Math.min(Math.min(limit * multiplier - taken, node.available), amount - taken));

            /* Record the liquidity allocation in our sources list */
            sources[count] = ILiquidity.NodeSource({tick: tick, used: take});

            taken += take;
            prevTick = tick;
        }

        /* If unable to source required liquidity amount from provided ticks */
        if (taken < amount) revert InsufficientLiquidity();

        return (sources, uint16(count));
    }
}
