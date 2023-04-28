// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/ILiquidity.sol";

/**
 * @title Interest Rate Model API
 */
abstract contract InterestRateModel {
    /**
     * Get interest rate for liquidity
     * @param amount Liquidity amount
     * @param rates Rates
     * @param nodes Liquidity nodes
     * @param count Liquidity node count
     * @return Interest per second
     */
    function _rate(
        uint256 amount,
        uint64[] memory rates,
        ILiquidity.NodeSource[] memory nodes,
        uint16 count
    ) internal view virtual returns (uint256);

    /**
     * Distribute interest to liquidity
     * @param amount Liquidity amount
     * @param interest Interest to distribute
     * @param nodes Liquidity nodes
     * @param count Liquidity node count
     * @return Interest distribution
     */
    function _distribute(
        uint256 amount,
        uint256 interest,
        ILiquidity.NodeSource[] memory nodes,
        uint16 count
    ) internal view virtual returns (uint128[] memory);
}
