// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import "../Pool.sol";
import "../rates/WeightedInterestRateModel.sol";
import "../filters/MerkleCollateralFilter.sol";

/**
 * @title Pool Configuration with a Weighted Interest Rate Model and Ranged Collection
 * Collateral Filter
 * @author MetaStreet Labs
 */
contract WeightedRateMerklePool is Pool, WeightedInterestRateModel, MerkleCollateralFilter {
    /**************************************************************************/
    /* State */
    /**************************************************************************/

    /**
     * @notice Initialized boolean
     */
    bool private _initialized;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    /**
     * @notice Pool constructor
     */
    constructor(
        address delegationRegistry_,
        address[] memory collateralWrappers
    ) Pool(delegationRegistry_, collateralWrappers) {
        /* Disable initialization of implementation contract */
        _initialized = true;
    }

    /**************************************************************************/
    /* Initializer */
    /**************************************************************************/

    function initialize(bytes memory params, address collateralLiquidator_) external {
        require(!_initialized, "Already initialized");

        _initialized = true;

        /* Decode parameters */
        (
            address collateralToken_,
            address currencyToken_,
            uint64[] memory durations_,
            uint64[] memory rates_,
            WeightedInterestRateModel.Parameters memory rateParameters,
            bytes32 merkleRoot_,
            uint32 nodeCount_
        ) = abi.decode(
                params,
                (address, address, uint64[], uint64[], WeightedInterestRateModel.Parameters, bytes32, uint32)
            );

        /* Initialize Pool */
        Pool._initialize(currencyToken_, collateralLiquidator_, durations_, rates_);

        /* Initialize Collateral Filter */
        MerkleCollateralFilter._initialize(collateralToken_, abi.encode(merkleRoot_, nodeCount_));

        /* Initialize Interest Rate Model */
        WeightedInterestRateModel._initialize(rateParameters);
    }
}
