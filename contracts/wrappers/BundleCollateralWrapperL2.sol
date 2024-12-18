// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import "./BundleCollateralWrapper.sol";

/**
 * @title Bundle Collateral Wrapper L2 (with larger max bundle size)
 * @author MetaStreet Labs
 */
contract BundleCollateralWrapperL2 is BundleCollateralWrapper {
    /**************************************************************************/
    /* Overrides */
    /**************************************************************************/

    /**
     * @inheritdoc BundleCollateralWrapper
     */
    function MAX_BUNDLE_SIZE() public pure override returns (uint256) {
        return 128;
    }
}
