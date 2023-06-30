// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import "./interfaces/ILiquidity.sol";

/**
 * @title LiquidityNodes
 * @author MetaStreet Labs
 */
library LiquidityNodes {
    /**************************************************************************/
    /* Errors */
    /**************************************************************************/

    /**
     * @notice Inactive node
     */
    error InactiveNode();

    /**************************************************************************/
    /* Getters */
    /**************************************************************************/

    /**
     * Get liquidity node at tick
     * @param liquidity Liquidity state
     * @param tick Tick
     * @return Liquidity node
     */
    function liquidityNode(
        ILiquidity.Liquidity storage liquidity,
        uint128 tick
    ) external view returns (ILiquidity.NodeInfo memory) {
        ILiquidity.Node storage node = liquidity.nodes[tick];

        return
            ILiquidity.NodeInfo({
                tick: tick,
                value: node.value,
                shares: node.shares,
                available: node.available,
                pending: node.pending,
                redemptions: node.redemptions.pending,
                prev: node.prev,
                next: node.next
            });
    }

    /**
     * Get liquidity nodes spanning [startTick, endTick] range where startTick
     * must be 0 or an instantiated tick
     * @param startTick Start tick
     * @param endTick End tick
     * @return Liquidity nodes
     */
    function liquidityNodes(
        ILiquidity.Liquidity storage liquidity,
        uint128 startTick,
        uint128 endTick
    ) external view returns (ILiquidity.NodeInfo[] memory) {
        /* Validate start tick has active liquidity */
        if (liquidity.nodes[startTick].next == 0) revert InactiveNode();

        /* Count nodes first to figure out how to size liquidity nodes array */
        uint256 i = 0;
        uint128 t = startTick;
        while (t != type(uint128).max && t <= endTick) {
            ILiquidity.Node storage node = liquidity.nodes[t];
            i++;
            t = node.next;
        }

        ILiquidity.NodeInfo[] memory nodes = new ILiquidity.NodeInfo[](i);

        /* Populate nodes */
        i = 0;
        t = startTick;
        while (t != type(uint128).max && t <= endTick) {
            ILiquidity.Node storage node = liquidity.nodes[t];
            nodes[i++] = ILiquidity.NodeInfo({
                tick: t,
                value: node.value,
                shares: node.shares,
                available: node.available,
                pending: node.pending,
                redemptions: node.redemptions.pending,
                prev: node.prev,
                next: node.next
            });
            t = node.next;
        }

        return nodes;
    }
}
