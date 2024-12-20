// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.25;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../interfaces/IPriceOracle.sol";

import "../integrations/Chainlink/AggregatorV3Interface.sol";

/**
 * @title Chainlink Price Oracle
 * @author MetaStreet Labs
 */
contract ChainlinkPriceOracle is IPriceOracle {
    /**************************************************************************/
    /* Errors */
    /**************************************************************************/

    /**
     * @notice Invalid price feed
     */
    error InvalidPriceFeed();

    /**
     * @notice Invalid price
     */
    error InvalidPrice();

    /**************************************************************************/
    /* State */
    /**************************************************************************/

    /**
     * @notice Base price feed
     */
    AggregatorV3Interface internal immutable _basePriceFeed;

    /**
     * @notice Quote price feed
     */
    AggregatorV3Interface internal immutable _quotePriceFeed;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    /**
     * @notice Chainlink Price Oracle constructor
     * @dev Example: To get the price of BTC in EUR, we need
     * @dev 1) Base price feed: BTC / USD
     * @dev 2) Quote price feed: EUR / USD
     * @param basePriceFeed_ Base price feed
     * @param quotePriceFeed_ Quote price feed
     */
    constructor(address basePriceFeed_, address quotePriceFeed_) {
        /* Validate price feeds */
        if (basePriceFeed_ == address(0) || quotePriceFeed_ == address(0)) revert InvalidPriceFeed();

        _basePriceFeed = AggregatorV3Interface(basePriceFeed_);
        _quotePriceFeed = AggregatorV3Interface(quotePriceFeed_);
    }

    /**************************************************************************/
    /* Getters */
    /**************************************************************************/

    /**
     * @notice Get address of base price feed
     * @return Base price feed
     */
    function basePriceFeed() external view returns (address) {
        return address(_basePriceFeed);
    }

    /**
     * @notice Get address of quote price feed
     * @return Quote price feed
     */
    function quotePriceFeed() external view returns (address) {
        return address(_quotePriceFeed);
    }

    /**************************************************************************/
    /* Internal Helpers */
    /**************************************************************************/

    /**
     * @notice Get derived price
     * @dev Adapted from https://docs.chain.link/data-feeds/using-data-feeds#getting-a-different-price-denomination
     * @param _decimals Decimals of the price
     * @return Derived price
     */
    function getDerivedPrice(uint8 _decimals) internal view returns (int256) {
        require(_decimals > uint8(0) && _decimals <= uint8(18), "Invalid _decimals");
        int256 decimals = int256(10 ** uint256(_decimals));
        (, int256 basePrice, , , ) = _basePriceFeed.latestRoundData();
        uint8 baseDecimals = _basePriceFeed.decimals();
        basePrice = scalePrice(basePrice, baseDecimals, _decimals);

        (, int256 quotePrice, , , ) = _quotePriceFeed.latestRoundData();
        uint8 quoteDecimals = _quotePriceFeed.decimals();
        quotePrice = scalePrice(quotePrice, quoteDecimals, _decimals);

        return (basePrice * decimals) / quotePrice;
    }

    /**
     * @notice Scale price
     * @dev Adapted from https://docs.chain.link/data-feeds/using-data-feeds#getting-a-different-price-denomination
     * @param _price Price to scale
     * @param _priceDecimals Decimals of the price
     * @param _decimals Decimals to scale to
     * @return Scaled price
     */
    function scalePrice(int256 _price, uint8 _priceDecimals, uint8 _decimals) internal pure returns (int256) {
        if (_priceDecimals < _decimals) {
            return _price * int256(10 ** uint256(_decimals - _priceDecimals));
        } else if (_priceDecimals > _decimals) {
            return _price / int256(10 ** uint256(_priceDecimals - _decimals));
        }
        return _price;
    }

    /**************************************************************************/
    /* API */
    /**************************************************************************/

    /**
     * @inheritdoc IPriceOracle
     */
    function price(
        address,
        address currencyToken,
        uint256[] memory,
        uint256[] memory,
        bytes calldata
    ) external view override returns (uint256) {
        /* Get decimals of pool currency token */
        uint8 decimals = IERC20Metadata(currencyToken).decimals();

        /* Get price of NFT scaled to pool currency token decimals */
        int256 nftPrice = getDerivedPrice(decimals);

        /* Validate price is non-zero and non-negative */
        if (nftPrice <= 0) revert InvalidPrice();

        /* Return price in terms of pool currency token */
        return uint256(nftPrice);
    }
}
