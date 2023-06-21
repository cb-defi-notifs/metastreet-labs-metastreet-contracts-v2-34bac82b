import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { TestERC20, TestERC721, PunkProxy, TestCryptoPunksMarket, PunkCollateralWrapper } from "../../typechain";

import { extractEvent, expectEvent } from "../helpers/EventUtilities";

describe("PunkCollateralWrapper", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let testCryptoPunksMarket: TestCryptoPunksMarket;
  let punkProxy: PunkProxy;
  let nft2: TestERC721;
  let punkCollateralWrapper: PunkCollateralWrapper;
  let accountBorrower: SignerWithAddress;
  let snapshotId: string;

  before("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const testCryptoPunksMarketFactory = await ethers.getContractFactory("TestCryptoPunksMarket");
    const testERC721Factory = await ethers.getContractFactory("TestERC721");
    const punkProxyFactory = await ethers.getContractFactory("PunkProxy");
    const punkCollateralWrapperFactory = await ethers.getContractFactory("PunkCollateralWrapper");

    tok1 = (await testERC20Factory.deploy("Token 1", "TOK1", 18, ethers.utils.parseEther("1000"))) as TestERC20;
    await tok1.deployed();

    testCryptoPunksMarket = (await testCryptoPunksMarketFactory.deploy()) as TestCryptoPunksMarket;
    await testCryptoPunksMarket.deployed();

    punkProxy = (await punkProxyFactory.deploy(testCryptoPunksMarket.address)) as PunkProxy;
    await punkProxy.deployed();

    nft2 = (await testERC721Factory.deploy("NFT 2", "NFT2", "https://nft2.com/token/")) as TestERC721;
    await nft2.deployed();

    punkCollateralWrapper = (await punkCollateralWrapperFactory.deploy(
      punkProxy.address,
      testCryptoPunksMarket.address
    )) as PunkCollateralWrapper;
    await punkCollateralWrapper.deployed();

    accountBorrower = accounts[1];

    /* Mint NFTs to borrower */
    await testCryptoPunksMarket.setInitialOwner(accountBorrower.address, 1);
    await testCryptoPunksMarket.allInitialOwnersAssigned();
    await nft2.mint(accountBorrower.address, 111);

    /* Approve token to transfer NFTs */
    await testCryptoPunksMarket.connect(accountBorrower).offerPunkForSaleToAddress(1, 0, punkProxy.address);
    await punkProxy.connect(accountBorrower).setApprovalForAll(punkCollateralWrapper.address, true);
    await nft2.connect(accountBorrower).setApprovalForAll(punkCollateralWrapper.address, true);
  });

  beforeEach("snapshot blockchain", async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);
  });

  afterEach("restore blockchain snapshot", async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  /****************************************************************************/
  /* Constants */
  /****************************************************************************/

  describe("constants", async function () {
    it("matches expected implementation version", async function () {
      expect(await punkCollateralWrapper.IMPLEMENTATION_VERSION()).to.equal("1.0");
    });
    it("returns correct name", async function () {
      expect(await punkCollateralWrapper.name()).to.equal("MetaStreet Punk Collateral Wrapper");
    });
    it("returns correct symbol", async function () {
      expect(await punkCollateralWrapper.symbol()).to.equal("MSPCW");
    });
  });

  /****************************************************************************/
  /* Primary API */
  /****************************************************************************/

  describe("#enumerate", async function () {
    it("enumerate punk", async function () {
      /* Mint punk */
      const mintTx1 = await punkCollateralWrapper.connect(accountBorrower).mint(1);

      /* Get token id */
      const tokenId1 = (await extractEvent(mintTx1, punkCollateralWrapper, "PunkMinted")).args.tokenId;

      /* Enumerate */
      const [token, tokenIds] = await punkCollateralWrapper.enumerate(tokenId1, "0x");

      /* Validate return */
      expect(token).to.equal(testCryptoPunksMarket.address);
      expect(tokenIds[0]).to.equal(1);
    });
  });

  describe("#mint", async function () {
    it("mints punk", async function () {
      /* Mint punk */
      const mintTx1 = await punkCollateralWrapper.connect(accountBorrower).mint(1);

      /* Get token id */
      const tokenId1 = (await extractEvent(mintTx1, punkCollateralWrapper, "PunkMinted")).args.tokenId;

      /* Validate events */
      await expectEvent(mintTx1, punkCollateralWrapper, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountBorrower.address,
        tokenId: tokenId1,
      });

      await expectEvent(mintTx1, punkCollateralWrapper, "PunkMinted", {
        tokenId: tokenId1,
        account: accountBorrower.address,
      });

      /* Validate state */
      expect(await punkCollateralWrapper.exists(tokenId1)).to.equal(true);
      expect(await punkCollateralWrapper.ownerOf(tokenId1)).to.equal(accountBorrower.address);

      expect(await punkProxy.ownerOf(1)).to.equal(punkCollateralWrapper.address);
    });

    it("can transfer PunkCollateralWrapperToken", async function () {
      /* Mint bundle */
      const mintTx1 = await punkCollateralWrapper.connect(accountBorrower).mint(1);

      /* Get token id */
      const tokenId1 = (await extractEvent(mintTx1, punkCollateralWrapper, "PunkMinted")).args.tokenId;

      /* Validate owner */
      expect(await punkCollateralWrapper.ownerOf(tokenId1)).to.equal(accountBorrower.address);

      /* Transfer token */
      await punkCollateralWrapper
        .connect(accountBorrower)
        .transferFrom(accountBorrower.address, accounts[2].address, tokenId1);

      /* Validate owner */
      expect(await punkCollateralWrapper.ownerOf(tokenId1)).to.equal(accounts[2].address);
    });

    it("fails on not owner of nft", async function () {
      await expect(punkCollateralWrapper.connect(accountBorrower).mint(2)).to.be.revertedWithCustomError(
        punkProxy,
        "Unauthorized"
      );
    });
  });

  describe("#unwrap", async function () {
    it("unwrap punk", async function () {
      /* Mint punk */
      const mintTx1 = await punkCollateralWrapper.connect(accountBorrower).mint(1);

      /* Get token id */
      const tokenId1 = (await extractEvent(mintTx1, punkCollateralWrapper, "PunkMinted")).args.tokenId;

      /* Validate current owner */
      expect(await punkCollateralWrapper.ownerOf(tokenId1)).to.equal(accountBorrower.address);

      /* Unwrap and validate events */
      await punkCollateralWrapper.connect(accountBorrower).unwrap(tokenId1, "0x");

      expect(await punkCollateralWrapper.exists(tokenId1)).to.equal(false);

      expect(await punkProxy.ownerOf(1)).to.equal(accountBorrower.address);
    });

    it("only token holder can unwrap bundle", async function () {
      /* Mint bundle */
      const mintTx1 = await punkCollateralWrapper.connect(accountBorrower).mint(1);

      /* Get token id */
      const tokenId1 = (await extractEvent(mintTx1, punkCollateralWrapper, "PunkMinted")).args.tokenId;

      /* Validate current owner */
      expect(await punkCollateralWrapper.ownerOf(tokenId1)).to.equal(accountBorrower.address);

      /* Attempt to unwrap */
      await expect(punkCollateralWrapper.connect(accounts[2]).unwrap(tokenId1, "0x")).to.be.revertedWithCustomError(
        punkCollateralWrapper,
        "InvalidCaller"
      );

      await expect(punkCollateralWrapper.unwrap(tokenId1, "0x")).to.be.revertedWithCustomError(
        punkCollateralWrapper,
        "InvalidCaller"
      );
    });
  });

  /****************************************************************************/
  /* ERC165 Interface */
  /****************************************************************************/

  describe("#supportsInterface", async function () {
    it("returns true on supported interfaces", async function () {
      /* ERC165 */
      expect(
        await punkCollateralWrapper.supportsInterface(punkCollateralWrapper.interface.getSighash("supportsInterface"))
      ).to.equal(true);

      /* ICollateralWrapper */
      expect(
        await punkCollateralWrapper.supportsInterface(
          ethers.utils.hexlify(
            ethers.BigNumber.from(punkCollateralWrapper.interface.getSighash("name"))
              .xor(ethers.BigNumber.from(punkCollateralWrapper.interface.getSighash("unwrap")))
              .xor(ethers.BigNumber.from(punkCollateralWrapper.interface.getSighash("enumerate")))
          )
        )
      ).to.equal(true);

      it("returns false on unsupported interfaces", async function () {
        expect(await punkCollateralWrapper.supportsInterface("0xaabbccdd")).to.equal(false);
        expect(await punkCollateralWrapper.supportsInterface("0x00000000")).to.equal(false);
        expect(await punkCollateralWrapper.supportsInterface("0xffffffff")).to.equal(false);
      });
    });
  });
});
