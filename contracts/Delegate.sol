// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import "./integrations/DelegateCash/IDelegationRegistry.sol";

/**
 * @title Delegate
 * @author MetaStreet Labs
 */
library Delegate {
    /**************************************************************************/
    /* Errors */
    /**************************************************************************/

    /**
     * @notice Invalid delegate
     */
    error InvalidDelegate();

    /**************************************************************************/
    /* Helper Functions */
    /**************************************************************************/

    /**
     * @notice Helper function that calls delegate.cash registry to delegate
     * token
     * @param collateralToken Collateral token
     * @param collateralTokenId Collateral token ID
     * @param delegateData Delegate data
     */
    function optionDelegateCash(
        IDelegationRegistry delegationRegistry,
        address collateralToken,
        uint256 collateralTokenId,
        bytes calldata delegateData
    ) external {
        if (delegateData.length != 0) {
            if (address(delegationRegistry) == address(0)) revert InvalidDelegate();
            if (delegateData.length != 20) revert InvalidDelegate();

            address delegate = address(uint160(bytes20(delegateData)));
            delegationRegistry.delegateForToken(delegate, collateralToken, collateralTokenId, true);
        }
    }

    /**
     * @dev Helper function to revoke token delegate
     * @param collateralToken Contract address of token that delegation is being removed from
     * @param collateralTokenId Token id of token that delegation is being removed from
     */
    function revokeDelegates(
        IDelegationRegistry delegationRegistry,
        address collateralToken,
        uint256 collateralTokenId
    ) external {
        /* No operation if _delegationRegistry not set */
        if (address(delegationRegistry) == address(0)) return;

        /* Get delegates for collateral token and id */
        address[] memory delegates = delegationRegistry.getDelegatesForToken(
            address(this),
            collateralToken,
            collateralTokenId
        );

        for (uint256 i; i < delegates.length; i++) {
            /* Revoke by setting value to false */
            delegationRegistry.delegateForToken(delegates[i], collateralToken, collateralTokenId, false);
        }
    }
}
