// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import {ICryptoPunksMarket} from "../../interfaces/ICryptoPunksMarket.sol";
import "../../interfaces/ICollateralWrapper.sol";

/**
 * @title Punk Collateral Wrapper
 */
contract PunkCollateralWrapper is ICollateralWrapper, ERC721, ReentrancyGuard {
    /**************************************************************************/
    /* Constants */
    /**************************************************************************/

    /**
     * @notice Implementation version
     */
    string public constant IMPLEMENTATION_VERSION = "1.0";

    /**************************************************************************/
    /* Errors */
    /**************************************************************************/

    /**
     * @notice Invalid caller
     */
    error InvalidCaller();

    /**************************************************************************/
    /* Events */
    /**************************************************************************/

    /**
     * @notice Emitted when punk collateral wrapper is minted
     * @param tokenId Token ID of the new collateral wrapper token
     * @param account Address that created the punk collateral wrapper
     */
    event PunkMinted(uint256 indexed tokenId, address indexed account);

    /**
     * @notice Emitted when punk collateral wrapper is unwrapped
     * @param tokenId Token ID of the punk collateral wrapper token
     * @param account Address that unwrapped the punk collateral wrapper
     */
    event PunkUnwrapped(uint256 indexed tokenId, address indexed account);

    /**************************************************************************/
    /* State */
    /**************************************************************************/

    address internal immutable _punkProxy;

    address internal immutable _punk;

    /**************************************************************************/
    /* Constructor */
    /**************************************************************************/

    /**
     * @notice PunkCollateralWrapper constructor
     */
    constructor(address punkProxy, address punk) ERC721("MetaStreet Punk Collateral Wrapper", "MSPCW") {
        _punkProxy = punkProxy;
        _punk = punk;
    }

    /**************************************************************************/
    /* Implementation */
    /**************************************************************************/

    /**
     * @inheritdoc ICollateralWrapper
     */
    function name() public pure override(ERC721, ICollateralWrapper) returns (string memory) {
        return "MetaStreet Punk Collateral Wrapper";
    }

    /**
     * @inheritdoc ERC721
     */
    function symbol() public pure override returns (string memory) {
        return "MSPCW";
    }

    /**
     * @notice Check if token ID exists
     * @param tokenId Token ID
     * @return True if token ID exists, otherwise false
     */
    function exists(uint256 tokenId) external view returns (bool) {
        return _exists(tokenId);
    }

    /**
     * @inheritdoc ICollateralWrapper
     */
    function enumerate(
        uint256 tokenId,
        bytes calldata
    ) external view returns (address token, uint256[] memory tokenIds) {
        /* Set token as punks address */
        token = _punk;

        /* Instantiate asset info array */
        tokenIds = new uint256[](1);

        /* Populate asset info array */
        tokenIds[0] = tokenId;
    }

    /**************************************************************************/
    /* User API */
    /**************************************************************************/

    /**
     * @notice Deposit Punk NFT collateral into contract and mint a PunkCollateralWrapper token
     *
     * Emits a {PunkMinted} event
     *
     * @param tokenId Punk token ID
     */
    function mint(uint256 tokenId) external nonReentrant returns (uint256) {
        IERC721(_punkProxy).transferFrom(msg.sender, address(this), tokenId);

        emit PunkMinted(tokenId, msg.sender);

        /* Mint PunkCollateralWrapper token */
        _mint(msg.sender, tokenId);

        return tokenId;
    }

    /**
     * Emits a {PunkUnwrapped} event
     *
     * @inheritdoc ICollateralWrapper
     */
    function unwrap(uint256 tokenId, bytes calldata) external nonReentrant {
        if (msg.sender != ownerOf(tokenId)) revert InvalidCaller();

        _burn(tokenId);

        /* Offer punk for sale to proxy address */
        ICryptoPunksMarket(_punk).offerPunkForSaleToAddress(tokenId, 0, _punkProxy);

        /* Transfer asset back to owner of token */
        IERC721(_punkProxy).transferFrom(address(this), msg.sender, tokenId);

        emit PunkUnwrapped(tokenId, msg.sender);
    }

    /******************************************************/
    /* ERC165 interface */
    /******************************************************/

    /**
     * @inheritdoc IERC165
     */
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(ICollateralWrapper).interfaceId || super.supportsInterface(interfaceId);
    }
}
