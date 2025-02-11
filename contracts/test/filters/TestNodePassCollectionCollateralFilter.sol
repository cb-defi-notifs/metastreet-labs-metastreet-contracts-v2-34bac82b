// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.25;

import "../../filters/NodePassCollectionCollateralFilter.sol";

/**
 * @title Test Contract Wrapper for NodePassCollectionCollateralFilter
 * @author MetaStreet Labs
 */
contract TestNodePassCollectionCollateralFilter is NodePassCollectionCollateralFilter {
    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    constructor(address yieldPassFactory, address nodeToken) NodePassCollectionCollateralFilter(yieldPassFactory) {
        _initialize(nodeToken);
    }

    /**************************************************************************/
    /* Wrapper for Primary API */
    /**************************************************************************/

    /**
     * @dev External wrapper function for _collateralSupported
     */
    function collateralSupported(
        address token,
        uint256 tokenId,
        uint256 index,
        bytes calldata context
    ) external view returns (bool) {
        return _collateralSupported(token, tokenId, index, context);
    }
}
