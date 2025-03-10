import { expect } from "chai";
import { ethers, network } from "hardhat";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import {
  TestERC20,
  TestERC721,
  TestLoanReceipt,
  EnglishAuctionCollateralLiquidator,
  BundleCollateralWrapper,
  TestCollateralLiquidatorJig,
  TestCollateralLiquidatorJigTruncated,
} from "../../typechain";

import { extractEvent, expectEvent } from "../helpers/EventUtilities";

describe("EnglishAuctionCollateralLiquidator", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let nft1: TestERC721;
  let loanReceiptLibrary: TestLoanReceipt;
  let collateralLiquidator: EnglishAuctionCollateralLiquidator;
  let testCollateralLiquidatorJig: TestCollateralLiquidatorJig;
  let testCollateralLiquidatorJigRevert: TestCollateralLiquidatorJig;
  let testCollateralLiquidatorJigTruncated: TestCollateralLiquidatorJigTruncated;
  let snapshotId: string;
  let accountLiquidator: SignerWithAddress;
  let accountBidder1: SignerWithAddress;
  let accountBidder2: SignerWithAddress;
  let accountBidder3: SignerWithAddress;
  let bundleCollateralWrapper: BundleCollateralWrapper;
  let bundleCollateralWrapperFake: BundleCollateralWrapper;
  let bundleTokenId: ethers.BigNumber;
  let bundleTokenIdFake: ethers.BigNumber;

  before("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const testERC721Factory = await ethers.getContractFactory("TestERC721");
    const testLoanReceiptFactory = await ethers.getContractFactory("TestLoanReceipt");
    const testProxyFactory = await ethers.getContractFactory("TestProxy");
    const englishAuctionCollateralLiquidatorFactory = await ethers.getContractFactory(
      "EnglishAuctionCollateralLiquidator"
    );
    const testCollateralLiquidatorJigFactory = await ethers.getContractFactory("TestCollateralLiquidatorJig");
    const testCollateralLiquidatorJigTruncatedFactory = await ethers.getContractFactory(
      "TestCollateralLiquidatorJigTruncated"
    );
    const bundleCollateralWrapperFactory = await ethers.getContractFactory("BundleCollateralWrapper");

    /* Deploy test currency token */
    tok1 = (await testERC20Factory.deploy("Token 1", "TOK1", 18, ethers.utils.parseEther("1000"))) as TestERC20;
    await tok1.deployed();

    /* Deploy test NFT */
    nft1 = (await testERC721Factory.deploy("NFT 1", "NFT1", "https://nft1.com/token/")) as TestERC721;
    await nft1.deployed();

    /* Deploy loan receipt library */
    loanReceiptLibrary = await testLoanReceiptFactory.deploy();
    await loanReceiptLibrary.deployed();

    /* Deploy bundle collateral wrapper */
    bundleCollateralWrapper = await bundleCollateralWrapperFactory.deploy();
    await bundleCollateralWrapper.deployed();

    /* Deploy non-approved bundle collateral wrapper */
    bundleCollateralWrapperFake = await bundleCollateralWrapperFactory.deploy();
    await bundleCollateralWrapper.deployed();

    /* Deploy collateral liquidator implementation */
    const collateralLiquidatorImpl = await englishAuctionCollateralLiquidatorFactory.deploy([
      bundleCollateralWrapper.address,
    ]);
    await collateralLiquidatorImpl.deployed();

    /* Deploy collateral liquidator */
    const proxy = await testProxyFactory.deploy(
      collateralLiquidatorImpl.address,
      collateralLiquidatorImpl.interface.encodeFunctionData("initialize", [
        ethers.BigNumber.from(86400),
        ethers.BigNumber.from(60 * 10),
        ethers.BigNumber.from(60 * 20),
        ethers.BigNumber.from(199),
      ])
    );
    await proxy.deployed();
    collateralLiquidator = (await ethers.getContractAt(
      "EnglishAuctionCollateralLiquidator",
      proxy.address
    )) as EnglishAuctionCollateralLiquidator;

    /* Deploy collateral liquidator testing jig */
    testCollateralLiquidatorJig = await testCollateralLiquidatorJigFactory.deploy(
      tok1.address,
      collateralLiquidator.address
    );
    await testCollateralLiquidatorJig.deployed();

    /* Deploy collateral liquidator testing jig that reverts onCollateralLiquidate */
    testCollateralLiquidatorJigRevert = await testCollateralLiquidatorJigFactory.deploy(
      tok1.address,
      collateralLiquidator.address
    );
    await testCollateralLiquidatorJigRevert.deployed();

    /* Deploy collateral liquidator testing jig that does not implement onCollateralLiquidate */
    testCollateralLiquidatorJigTruncated = await testCollateralLiquidatorJigTruncatedFactory.deploy(
      tok1.address,
      collateralLiquidator.address
    );
    await testCollateralLiquidatorJigRevert.deployed();

    accountLiquidator = accounts[3];
    accountBidder1 = accounts[4];
    accountBidder2 = accounts[5];
    accountBidder3 = accounts[6];

    /* Mint NFT and create a bundled collateral token */
    await nft1.mint(accountLiquidator.address, 123);
    await nft1.mint(accountLiquidator.address, 124);
    await nft1.mint(accountLiquidator.address, 125);
    await nft1.connect(accountLiquidator).setApprovalForAll(bundleCollateralWrapper.address, true);
    const mintTx = await bundleCollateralWrapper.connect(accountLiquidator).mint(nft1.address, [123, 124, 125]);
    bundleTokenId = (await extractEvent(mintTx, bundleCollateralWrapper, "BundleMinted")).args.tokenId;

    /* Mint NFT and create a fake bundled collateral token */
    await nft1.mint(accountLiquidator.address, 126);
    await nft1.mint(accountLiquidator.address, 127);
    await nft1.mint(accountLiquidator.address, 128);
    await nft1.connect(accountLiquidator).setApprovalForAll(bundleCollateralWrapperFake.address, true);
    const mintTxFake = await bundleCollateralWrapperFake.connect(accountLiquidator).mint(nft1.address, [126, 127, 128]);
    bundleTokenIdFake = (await extractEvent(mintTxFake, bundleCollateralWrapperFake, "BundleMinted")).args.tokenId;

    /* Transfer bundled collateral token to testing jig */
    await bundleCollateralWrapper
      .connect(accountLiquidator)
      .transferFrom(accountLiquidator.address, testCollateralLiquidatorJig.address, bundleTokenId);
    await bundleCollateralWrapperFake
      .connect(accountLiquidator)
      .transferFrom(accountLiquidator.address, testCollateralLiquidatorJig.address, bundleTokenIdFake);

    /* Mint NFT to testing jig to simulate default */
    await nft1.mint(testCollateralLiquidatorJig.address, 122);
    await nft1.mint(testCollateralLiquidatorJig.address, 456);

    /* Mint NFT to an EOA */
    await nft1.mint(accountBidder1.address, 129);
    await nft1.connect(accountBidder1).approve(collateralLiquidator.address, 129);

    /* Mint NFT to a testing jig that reverts onCollateralLiquidate() */
    await nft1.mint(testCollateralLiquidatorJigRevert.address, 130);

    /* Mint NFT to a testing jig that does not implement onCollateralLiquidate() */
    await nft1.mint(testCollateralLiquidatorJigTruncated.address, 131);

    /* Transfer token to liquidator account and bidder accounts */
    await tok1.transfer(accountLiquidator.address, ethers.utils.parseEther("200"));
    await tok1.transfer(accountBidder1.address, ethers.utils.parseEther("200"));
    await tok1.transfer(accountBidder2.address, ethers.utils.parseEther("200"));
    await tok1.transfer(accountBidder3.address, ethers.utils.parseEther("200"));

    /* Approve collateral liquidator to transfer token */
    await tok1.connect(accountLiquidator).approve(collateralLiquidator.address, ethers.constants.MaxUint256);
    await tok1.connect(accountBidder1).approve(collateralLiquidator.address, ethers.constants.MaxUint256);
    await tok1.connect(accountBidder2).approve(collateralLiquidator.address, ethers.constants.MaxUint256);
    await tok1.connect(accountBidder3).approve(collateralLiquidator.address, ethers.constants.MaxUint256);
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
    it("matches expected implementation", async function () {
      expect(await collateralLiquidator.IMPLEMENTATION_VERSION()).to.equal("1.1");
    });
    it("matches expected name", async function () {
      expect(await collateralLiquidator.name()).to.equal("EnglishAuctionCollateralLiquidator");
    });
  });

  /****************************************************************************/
  /* Helper Functions */
  /****************************************************************************/

  const loanReceiptTemplate = {
    version: 1,
    principal: ethers.BigNumber.from("3000000000000000000"),
    repayment: ethers.BigNumber.from("3040000000000000000"),
    borrower: "0x0CD36Fa7D9634994231Bc76Fb36938D56C6FE70E",
    maturity: 1685595600,
    duration: 2592000,
    collateralToken: ethers.constants.AddressZero /* To be populated */,
    collateralTokenId: 0 /* To be populated */,
    collateralWrapperContextLen: 0,
    collateralWrapperContext: "0x",
    nodeReceipts: [
      {
        tick: ethers.BigNumber.from("1000000000000000000"),
        used: ethers.BigNumber.from("1000000000000000000"),
        pending: ethers.BigNumber.from("1010000000000000000"),
      },
      {
        tick: ethers.BigNumber.from("2000000000000000000"),
        used: ethers.BigNumber.from("1000000000000000000"),
        pending: ethers.BigNumber.from("1010000000000000000"),
      },
      {
        tick: ethers.BigNumber.from("3000000000000000000"),
        used: ethers.BigNumber.from("1000000000000000000"),
        pending: ethers.BigNumber.from("1020000000000000000"),
      },
    ],
  };

  function makeLoanReceipt(
    collateralToken: string,
    collateralTokenId: number,
    collateralWrapperContextLen: number,
    collateralWrapperContext: string
  ) {
    return {
      ...loanReceiptTemplate,
      collateralToken,
      collateralTokenId,
      collateralWrapperContextLen,
      collateralWrapperContext,
    };
  }

  async function getBlockTimestamp(blockNumber: ethers.BigNumber): Promise<ethers.BigNumber> {
    const block = await ethers.provider.getBlock(blockNumber);
    return block.timestamp;
  }

  /****************************************************************************/
  /* Getters */
  /****************************************************************************/

  describe("getters", async function () {
    it("returns auction duration", async function () {
      expect(await collateralLiquidator.auctionDuration()).to.equal(ethers.BigNumber.from(86400));
    });
    it("returns time extension window", async function () {
      expect(await collateralLiquidator.timeExtensionWindow()).to.equal(ethers.BigNumber.from(60 * 10));
    });
    it("returns time extension", async function () {
      expect(await collateralLiquidator.timeExtension()).to.equal(ethers.BigNumber.from(60 * 20));
    });
    it("returns minimum bid basis point", async function () {
      expect(await collateralLiquidator.minimumBidBasisPoints()).to.equal(ethers.BigNumber.from(199));
    });
  });

  /****************************************************************************/
  /* Primay API */
  /****************************************************************************/

  describe("#liquidate", async function () {
    it("succeeds starting an auction on collateral", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Construct loan receipt hash */
      const loanReceiptHash = ethers.utils.solidityKeccak256(
        ["bytes"],
        [ethers.utils.solidityPack(["uint256", "bytes"], [network.config.chainId, loanReceipt])]
      );

      /* Calling liquidate() */
      const liquidateTx = await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Validate events */
      const liquidationHash = (await extractEvent(liquidateTx, collateralLiquidator, "LiquidationStarted")).args[0];
      await expect(liquidateTx)
        .to.emit(collateralLiquidator, "LiquidationStarted")
        .withArgs(liquidationHash, testCollateralLiquidatorJig.address, loanReceiptHash, tok1.address, 1);
      await expect(liquidateTx)
        .to.emit(collateralLiquidator, "AuctionCreated")
        .withArgs(liquidationHash, nft1.address, 122);

      /* Validate state */
      const liquidation = await collateralLiquidator.liquidations(liquidationHash);
      await expect(liquidation.proceeds).to.equal(0);
      await expect(liquidation.auctionCount).to.equal(1);
      await expect(liquidation.source).to.equal(testCollateralLiquidatorJig.address);
      await expect(liquidation.currencyToken).to.equal(tok1.address);
      await expect(liquidation.liquidationContextHash).to.equal(loanReceiptHash);

      const auction = await collateralLiquidator.auctions(nft1.address, 122);
      await expect(auction.endTime).to.equal(0);
      await expect(auction.highestBid).to.equal(0);
      await expect(auction.highestBidder).to.equal(ethers.constants.AddressZero);
    });

    it("succeeds starting an auction on bundled collateral", async function () {
      /* Underlying collateral token IDs */
      const tokenIds = [123, 124, 125];

      /* Construct collateral wrapper context */
      const collateralWrapperContext = ethers.utils.solidityPack(["address", "uint256[]"], [nft1.address, tokenIds]);

      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(
        makeLoanReceipt(
          bundleCollateralWrapper.address,
          bundleTokenId,
          ethers.utils.arrayify(collateralWrapperContext).length,
          collateralWrapperContext
        )
      );

      /* Construct loan receipt hash */
      const loanReceiptHash = ethers.utils.solidityKeccak256(
        ["bytes"],
        [ethers.utils.solidityPack(["uint256", "bytes"], [network.config.chainId, loanReceipt])]
      );

      /* Calling liquidate() */
      const liquidateTx = await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Validate events */
      const liquidationHash = (await extractEvent(liquidateTx, collateralLiquidator, "LiquidationStarted")).args[0];
      await expect(liquidateTx)
        .to.emit(collateralLiquidator, "LiquidationStarted")
        .withArgs(liquidationHash, testCollateralLiquidatorJig.address, loanReceiptHash, tok1.address, 3);
      for (const [index, tokenId] of tokenIds.entries()) {
        const eventArgs = (await extractEvent(liquidateTx, collateralLiquidator, "AuctionCreated", index)).args;
        await expect(eventArgs[0]).to.equal(liquidationHash);
      }
      await expect(liquidateTx)
        .to.emit(collateralLiquidator, "AuctionCreated")
        .withArgs(liquidationHash, nft1.address, tokenIds[0])
        .to.emit(collateralLiquidator, "AuctionCreated")
        .withArgs(liquidationHash, nft1.address, tokenIds[1])
        .to.emit(collateralLiquidator, "AuctionCreated")
        .withArgs(liquidationHash, nft1.address, tokenIds[2]);

      /* Validate state */
      for (const [index, tokenId] of tokenIds.entries()) {
        const auction = await collateralLiquidator.auctions(nft1.address, tokenId);
        await expect(auction.endTime).to.equal(0);
        await expect(auction.highestBid).to.equal(0);
        await expect(auction.highestBidder).to.equal(ethers.constants.AddressZero);
      }
    });

    it("succeeds starting an auction on non-approved bundled collateral but does not unwrap", async function () {
      /* Underlying collateral token IDs */
      const tokenIds = [126, 127, 128];

      /* Construct collateral wrapper context */
      const collateralWrapperContext = ethers.utils.solidityPack(["address", "uint256[]"], [nft1.address, tokenIds]);

      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(
        makeLoanReceipt(
          bundleCollateralWrapperFake.address,
          bundleTokenIdFake,
          ethers.utils.arrayify(collateralWrapperContext).length,
          collateralWrapperContext
        )
      );

      /* Construct loan receipt hash */
      const loanReceiptHash = ethers.utils.solidityKeccak256(
        ["bytes"],
        [ethers.utils.solidityPack(["uint256", "bytes"], [network.config.chainId, loanReceipt])]
      );

      /* Calling liquidate() */
      const liquidateTx = await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Validate events */
      const liquidationHash = (await extractEvent(liquidateTx, collateralLiquidator, "LiquidationStarted")).args[0];
      await expect(liquidateTx)
        .to.emit(collateralLiquidator, "LiquidationStarted")
        .withArgs(liquidationHash, testCollateralLiquidatorJig.address, loanReceiptHash, tok1.address, 1);
      await expect(liquidateTx)
        .to.emit(collateralLiquidator, "AuctionCreated")
        .withArgs(liquidationHash, bundleCollateralWrapperFake.address, bundleTokenIdFake);

      /* Validate state */
      const liquidation = await collateralLiquidator.liquidations(liquidationHash);
      await expect(liquidation.proceeds).to.equal(0);
      await expect(liquidation.auctionCount).to.equal(1);
      await expect(liquidation.source).to.equal(testCollateralLiquidatorJig.address);
      await expect(liquidation.currencyToken).to.equal(tok1.address);
      await expect(liquidation.liquidationContextHash).to.equal(loanReceiptHash);

      const auction = await collateralLiquidator.auctions(bundleCollateralWrapperFake.address, bundleTokenIdFake);
      await expect(auction.endTime).to.equal(0);
      await expect(auction.highestBid).to.equal(0);
      await expect(auction.highestBidder).to.equal(ethers.constants.AddressZero);
    });

    it("fails if there exists the same liquidation hash", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Disable automining to combine next two transactions into same block */
      await network.provider.send("evm_setAutomine", [false]);

      /* Calling liquidate() */
      await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Re-enable automining */
      await network.provider.send("evm_setAutomine", [true]);

      /* Calling liquidate() again in same block */
      await expect(
        collateralLiquidator.connect(accountBidder1).liquidate(tok1.address, nft1.address, 122, "0x", loanReceipt)
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidLiquidation");
    });

    it("fails with invalid token", async function () {
      /* Construct loan receipt */
      const loanReceipt1 = await loanReceiptLibrary.encode(makeLoanReceipt(ethers.constants.AddressZero, 122, 0, "0x"));

      /* Liquidate with invalid collateral token */
      await expect(
        collateralLiquidator.liquidate(tok1.address, ethers.constants.AddressZero, 122, "0x", loanReceipt1)
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidToken");

      /* Construct loan receipt */
      const loanReceipt2 = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Liquidate with invalid currency token */
      await expect(
        collateralLiquidator
          .connect(accountBidder1)
          .liquidate(ethers.constants.AddressZero, nft1.address, 122, "0x", loanReceipt2)
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidToken");
    });
  });

  describe("#bid", async function () {
    it("3 successful bids on same auction", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Calling liquidate() */
      const liquidateTx = await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Get liquidationHash */
      const liquidationHash = (await extractEvent(liquidateTx, collateralLiquidator, "LiquidationStarted")).args[0];

      /* Bid with accountBidder1 */
      const bid1Tx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 122, ethers.utils.parseEther("100"));
      const transactionTime = await getBlockTimestamp(bid1Tx.blockNumber);

      /* Validate events */
      await expectEvent(bid1Tx, tok1, "Transfer", {
        from: accountBidder1.address,
        to: collateralLiquidator.address,
        value: ethers.utils.parseEther("100"),
      });

      await expectEvent(bid1Tx, collateralLiquidator, "AuctionStarted", {
        liquidationHash: liquidationHash,
        collateralToken: nft1.address,
        collateralTokenId: 122,
        endTime: transactionTime + 86400,
      });

      await expectEvent(bid1Tx, collateralLiquidator, "AuctionBid", {
        liquidationHash: liquidationHash,
        collateralToken: nft1.address,
        collateralTokenId: 122,
        bidder: accountBidder1.address,
        amount: ethers.utils.parseEther("100"),
      });

      /* Validate state */
      let auction = await collateralLiquidator.auctions(nft1.address, 122);
      await expect(auction.endTime).to.equal(transactionTime + 86400);
      await expect(auction.highestBid).to.equal(ethers.utils.parseEther("100"));
      await expect(auction.highestBidder).to.equal(accountBidder1.address);

      /* Bid with accountBidder2 */
      const bid2Tx = await collateralLiquidator
        .connect(accountBidder2)
        .bid(nft1.address, 122, ethers.utils.parseEther("102"));

      /* Validate events */
      await expectEvent(bid2Tx, tok1, "Transfer", {
        from: collateralLiquidator.address,
        to: accountBidder1.address,
        value: ethers.utils.parseEther("100"),
      });

      await expectEvent(
        bid2Tx,
        tok1,
        "Transfer",
        {
          from: accountBidder2.address,
          to: collateralLiquidator.address,
          value: ethers.utils.parseEther("102"),
        },
        1
      );

      await expectEvent(bid2Tx, collateralLiquidator, "AuctionBid", {
        liquidationHash: liquidationHash,
        collateralToken: nft1.address,
        collateralTokenId: 122,
        bidder: accountBidder2.address,
        amount: ethers.utils.parseEther("102"),
      });

      /* Validate state */
      auction = await collateralLiquidator.auctions(nft1.address, 122);
      await expect(auction.endTime).to.equal(transactionTime + 86400);
      await expect(auction.highestBid).to.equal(ethers.utils.parseEther("102"));
      await expect(auction.highestBidder).to.equal(accountBidder2.address);

      /* Bid with accountBidder1 */
      const bid3Tx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 122, ethers.utils.parseEther("105"));

      /* Validate events */
      await expectEvent(bid3Tx, tok1, "Transfer", {
        from: collateralLiquidator.address,
        to: accountBidder2.address,
        value: ethers.utils.parseEther("102"),
      });

      await expectEvent(
        bid3Tx,
        tok1,
        "Transfer",
        {
          from: accountBidder1.address,
          to: collateralLiquidator.address,
          value: ethers.utils.parseEther("105"),
        },
        1
      );

      await expectEvent(bid3Tx, collateralLiquidator, "AuctionBid", {
        liquidationHash: liquidationHash,
        collateralToken: nft1.address,
        collateralTokenId: 122,
        bidder: accountBidder1.address,
        amount: ethers.utils.parseEther("105"),
      });

      /* Validate state */
      auction = await collateralLiquidator.auctions(nft1.address, 122);
      await expect(auction.endTime).to.equal(transactionTime + 86400);
      await expect(auction.highestBid).to.equal(ethers.utils.parseEther("105"));
      await expect(auction.highestBidder).to.equal(accountBidder1.address);
    });

    it("extends time on an auction within 10 minutes of end time", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Calling liquidate() */
      const liquidateTx = await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Get liquidationHash */
      const liquidationHash = (await extractEvent(liquidateTx, collateralLiquidator, "LiquidationStarted")).args[0];

      /* Bid with accountBidder1 */
      const bid1Tx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 122, ethers.utils.parseEther("1"));

      /* Fast forward to 10 minutes before end time */
      const transactionTime = await getBlockTimestamp(bid1Tx.blockNumber);
      await helpers.time.increaseTo(transactionTime + 86400 - 10 * 60);

      /* Bid with accountBidder1 */
      const bid2Tx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 122, ethers.utils.parseEther("2"));

      /* Validate events */
      const bid2TransactionTime = await getBlockTimestamp(bid2Tx.blockNumber);
      await expectEvent(bid2Tx, collateralLiquidator, "AuctionExtended", {
        liquidationHash: liquidationHash,
        collateralToken: nft1.address,
        collateralTokenId: 122,
        endTime: bid2TransactionTime + 60 * 20,
      });

      /* Validate state */
      let auction = await collateralLiquidator.auctions(nft1.address, 122);
      await expect(auction.endTime).to.equal(bid2TransactionTime + 60 * 20);
    });

    it("fails when auction does not exist", async function () {
      /* Bid with accountBidder1 */
      await expect(
        collateralLiquidator.connect(accountBidder1).bid(nft1.address, 1000, ethers.utils.parseEther("1"))
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidAuction");
    });

    it("fails when bid with 0 amount", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Calling liquidate() */
      await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Bid with accountBidder1 */
      await expect(
        collateralLiquidator.connect(accountBidder1).bid(nft1.address, 122, ethers.utils.parseEther("0"))
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidBid");
    });

    it("fails when bid after end time", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Calling liquidate() */
      await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Bid with accountBidder1 */
      const bid1Tx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 122, ethers.utils.parseEther("1"));

      /* Fast forward to 1 second after end time */
      const transactionTime = await getBlockTimestamp(bid1Tx.blockNumber);
      await helpers.time.increaseTo(transactionTime + 86400 + 1);

      /* Bid with accountBidder1 */
      await expect(
        collateralLiquidator.connect(accountBidder1).bid(nft1.address, 122, ethers.utils.parseEther("2"))
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidBid");
    });

    it("fails when bid with same amount as previous bid", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Calling liquidate() */
      await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Bid with accountBidder1 */
      await collateralLiquidator.connect(accountBidder1).bid(nft1.address, 122, ethers.utils.parseEther("2"));

      /* Bid with accountBidder2 */
      await expect(
        collateralLiquidator.connect(accountBidder2).bid(nft1.address, 122, ethers.utils.parseEther("2"))
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidBid");
    });

    it("fails when bid with amount smaller than minimum bid increment", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Calling liquidate() */
      await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Bid with accountBidder1 */
      await collateralLiquidator.connect(accountBidder1).bid(nft1.address, 122, ethers.utils.parseEther("100"));

      /* Bid with accountBidder2 */
      await expect(
        collateralLiquidator.connect(accountBidder2).bid(nft1.address, 122, ethers.utils.parseEther("101"))
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidBid");
    });

    it("fails when bid with amount smaller than previous bid", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Calling liquidate() */
      await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Bid with accountBidder1 */
      await collateralLiquidator.connect(accountBidder1).bid(nft1.address, 122, ethers.utils.parseEther("100"));

      /* Bid with accountBidder2 */
      await expect(
        collateralLiquidator.connect(accountBidder2).bid(nft1.address, 122, ethers.utils.parseEther("99"))
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidBid");
    });
  });

  describe("#claim", async function () {
    it("claims single collateral", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Construct loan receipt hash */
      const loanReceiptHash = ethers.utils.solidityKeccak256(
        ["bytes"],
        [ethers.utils.solidityPack(["uint256", "bytes"], [network.config.chainId, loanReceipt])]
      );

      /* Calling liquidate() */
      const liquidateTx = await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Get liquidationHash */
      const liquidationHash = (await extractEvent(liquidateTx, collateralLiquidator, "LiquidationStarted")).args[0];

      /* Bid with accountBidder1 */
      const bidTx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 122, ethers.utils.parseEther("2"));

      /* Fast forward to 1 second after end time */
      const transactionTime = await getBlockTimestamp(bidTx.blockNumber);
      await helpers.time.increaseTo(transactionTime + 86400 + 1);

      /* Claim with accountBidder1 */
      const claimTx = await collateralLiquidator.connect(accountBidder1).claim(nft1.address, 122, loanReceipt);

      /* Validate events */
      await expectEvent(claimTx, nft1, "Transfer", {
        from: collateralLiquidator.address,
        to: accountBidder1.address,
        tokenId: 122,
      });

      await expect(claimTx)
        .to.emit(collateralLiquidator, "AuctionEnded")
        .withArgs(liquidationHash, nft1.address, 122, accountBidder1.address, ethers.utils.parseEther("2"));

      await expect(claimTx)
        .to.emit(collateralLiquidator, "LiquidationEnded")
        .withArgs(liquidationHash, ethers.utils.parseEther("2"));

      await expect(claimTx)
        .to.emit(testCollateralLiquidatorJig, "CollateralLiquidated")
        .withArgs(ethers.utils.parseEther("2"));

      await expectEvent(claimTx, tok1, "Transfer", {
        from: collateralLiquidator.address,
        to: testCollateralLiquidatorJig.address,
        value: ethers.utils.parseEther("2"),
      });

      /* Validate state */
      const auction = await collateralLiquidator.auctions(nft1.address, 122);
      await expect(auction.endTime).to.equal(ethers.constants.Zero);

      const liquidation = await collateralLiquidator.liquidations(liquidationHash);
      await expect(liquidation.source).to.equal(ethers.constants.AddressZero);
      await expect(liquidation.proceeds).to.equal(ethers.constants.Zero);
      await expect(liquidation.auctionCount).to.equal(ethers.constants.Zero);
      await expect(liquidation.currencyToken).to.equal(ethers.constants.AddressZero);
      await expect(liquidation.liquidationContextHash).to.equal(ethers.constants.HashZero);
    });

    it("claims bundled collateral", async function () {
      /* Underlying collateral token IDs */
      const tokenIds = [123, 124, 125];

      /* Construct collateral wrapper context */
      const collateralWrapperContext = ethers.utils.solidityPack(["address", "uint256[]"], [nft1.address, tokenIds]);

      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(
        makeLoanReceipt(
          bundleCollateralWrapper.address,
          bundleTokenId,
          ethers.utils.arrayify(collateralWrapperContext).length,
          collateralWrapperContext
        )
      );

      /* Construct loan receipt hash */
      const loanReceiptHash = ethers.utils.solidityKeccak256(
        ["bytes"],
        [ethers.utils.solidityPack(["uint256", "bytes"], [network.config.chainId, loanReceipt])]
      );

      /* Calling liquidate() */
      const liquidateTx = await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Validate events */
      const liquidationHash = (await extractEvent(liquidateTx, collateralLiquidator, "LiquidationStarted")).args[0];
      await expect(liquidateTx)
        .to.emit(collateralLiquidator, "LiquidationStarted")
        .withArgs(liquidationHash, testCollateralLiquidatorJig.address, loanReceiptHash, tok1.address, 3);
      for (const [index, tokenId] of tokenIds.entries()) {
        const eventArgs = (await extractEvent(liquidateTx, collateralLiquidator, "AuctionCreated", index)).args;
        await expect(eventArgs[0]).to.equal(liquidationHash);
      }

      /* Bid with accountBidder1 */
      const bid1Tx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 123, ethers.utils.parseEther("1"));

      /* Bid with accountBidder2 */
      await collateralLiquidator.connect(accountBidder2).bid(nft1.address, 124, ethers.utils.parseEther("2"));

      /* Bid with accountBidder3 */
      await collateralLiquidator.connect(accountBidder3).bid(nft1.address, 125, ethers.utils.parseEther("3"));

      /* Fast forward to 1 second after end time */
      const transactionTime = await getBlockTimestamp(bid1Tx.blockNumber);
      await helpers.time.increaseTo(transactionTime + 86400 + 1);

      /* Claim with accountBidder1 */
      const claim1Tx = await collateralLiquidator.connect(accountBidder1).claim(nft1.address, 123, loanReceipt);

      /* Validate events */
      await expectEvent(claim1Tx, nft1, "Transfer", {
        from: collateralLiquidator.address,
        to: accountBidder1.address,
        tokenId: 123,
      });

      await expect(claim1Tx)
        .to.emit(collateralLiquidator, "AuctionEnded")
        .withArgs(liquidationHash, nft1.address, 123, accountBidder1.address, ethers.utils.parseEther("1"));

      /* Validate state */
      const auction1 = await collateralLiquidator.auctions(nft1.address, 123);
      await expect(auction1.endTime).to.equal(ethers.constants.Zero);

      const liquidation1 = await collateralLiquidator.liquidations(liquidationHash);
      await expect(liquidation1.source).to.equal(testCollateralLiquidatorJig.address);
      await expect(liquidation1.proceeds).to.equal(ethers.utils.parseEther("1"));
      await expect(liquidation1.auctionCount).to.equal(2);
      await expect(liquidation1.currencyToken).to.equal(tok1.address);
      await expect(liquidation1.liquidationContextHash).to.equal(loanReceiptHash);

      /* Claim with accountBidder2 */
      const claim2Tx = await collateralLiquidator.connect(accountBidder2).claim(nft1.address, 124, loanReceipt);

      /* Validate events */
      await expectEvent(claim2Tx, nft1, "Transfer", {
        from: collateralLiquidator.address,
        to: accountBidder2.address,
        tokenId: 124,
      });

      await expect(claim2Tx)
        .to.emit(collateralLiquidator, "AuctionEnded")
        .withArgs(liquidationHash, nft1.address, 124, accountBidder2.address, ethers.utils.parseEther("2"));

      /* Validate state */
      const auction2 = await collateralLiquidator.auctions(nft1.address, 124);
      await expect(auction2.endTime).to.equal(ethers.constants.Zero);

      const liquidation2 = await collateralLiquidator.liquidations(liquidationHash);
      await expect(liquidation2.source).to.equal(testCollateralLiquidatorJig.address);
      await expect(liquidation2.proceeds).to.equal(ethers.utils.parseEther("3"));
      await expect(liquidation2.auctionCount).to.equal(1);
      await expect(liquidation2.currencyToken).to.equal(tok1.address);
      await expect(liquidation2.liquidationContextHash).to.equal(loanReceiptHash);

      /* Claim with accountBidder3 */
      const claim3Tx = await collateralLiquidator.connect(accountBidder3).claim(nft1.address, 125, loanReceipt);

      /* Validate events */
      await expectEvent(claim3Tx, nft1, "Transfer", {
        from: collateralLiquidator.address,
        to: accountBidder3.address,
        tokenId: 125,
      });

      await expect(claim3Tx)
        .to.emit(collateralLiquidator, "AuctionEnded")
        .withArgs(liquidationHash, nft1.address, 125, accountBidder3.address, ethers.utils.parseEther("3"));

      await expect(claim3Tx)
        .to.emit(collateralLiquidator, "LiquidationEnded")
        .withArgs(liquidationHash, ethers.utils.parseEther("6"));

      await expect(claim3Tx)
        .to.emit(testCollateralLiquidatorJig, "CollateralLiquidated")
        .withArgs(ethers.utils.parseEther("6"));

      await expectEvent(claim3Tx, tok1, "Transfer", {
        from: collateralLiquidator.address,
        to: testCollateralLiquidatorJig.address,
        value: ethers.utils.parseEther("6"),
      });

      /* Validate state */
      const auction3 = await collateralLiquidator.auctions(nft1.address, 125);
      await expect(auction3.endTime).to.equal(ethers.constants.Zero);

      const liquidation3 = await collateralLiquidator.liquidations(liquidationHash);
      await expect(liquidation3.source).to.equal(ethers.constants.AddressZero);
      await expect(liquidation3.proceeds).to.equal(ethers.constants.Zero);
      await expect(liquidation3.auctionCount).to.equal(0);
      await expect(liquidation3.currencyToken).to.equal(ethers.constants.AddressZero);
      await expect(liquidation3.liquidationContextHash).to.equal(ethers.constants.HashZero);
    });

    it("claims as non-winner", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Calling liquidate() */
      const liquidateTx = await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Get liquidationHash */
      const liquidationHash = (await extractEvent(liquidateTx, collateralLiquidator, "LiquidationStarted")).args[0];

      /* Bid with accountBidder1 */
      const bidTx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 122, ethers.utils.parseEther("2"));

      /* Fast forward to 1 second after end time */
      const transactionTime = await getBlockTimestamp(bidTx.blockNumber);
      await helpers.time.increaseTo(transactionTime + 86400 + 1);

      /* Claim with accountBidder2 */
      const claimTx = await collateralLiquidator.connect(accountBidder2).claim(nft1.address, 122, loanReceipt);

      /* Validate events */
      await expect(claimTx)
        .to.emit(collateralLiquidator, "AuctionEnded")
        .withArgs(liquidationHash, nft1.address, 122, accountBidder1.address, ethers.utils.parseEther("2"));

      await expect(claimTx)
        .to.emit(collateralLiquidator, "LiquidationEnded")
        .withArgs(liquidationHash, ethers.utils.parseEther("2"));

      await expect(claimTx)
        .to.emit(testCollateralLiquidatorJig, "CollateralLiquidated")
        .withArgs(ethers.utils.parseEther("2"));

      await expectEvent(claimTx, tok1, "Transfer", {
        from: collateralLiquidator.address,
        to: testCollateralLiquidatorJig.address,
        value: ethers.utils.parseEther("2"),
      });

      /* Validate state */
      const auction = await collateralLiquidator.auctions(nft1.address, 122);
      await expect(auction.endTime).to.equal(ethers.constants.Zero);

      const liquidation = await collateralLiquidator.liquidations(liquidationHash);
      await expect(liquidation.source).to.equal(ethers.constants.AddressZero);
      await expect(liquidation.proceeds).to.equal(ethers.constants.Zero);
      await expect(liquidation.auctionCount).to.equal(0);
      await expect(liquidation.currencyToken).to.equal(ethers.constants.AddressZero);
      await expect(liquidation.liquidationContextHash).to.equal(ethers.constants.HashZero);
    });

    it("claims collateral liquidated by EOA", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 129, 0, "0x"));

      /* Calling liquidate() */
      const liquidateTx = await collateralLiquidator
        .connect(accountBidder1)
        .liquidate(tok1.address, nft1.address, 129, "0x", loanReceipt);

      /* Get liquidationHash */
      const liquidationHash = (await extractEvent(liquidateTx, collateralLiquidator, "LiquidationStarted")).args[0];

      /* Bid with accountBidder1 */
      const bidTx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 129, ethers.utils.parseEther("2"));

      /* Fast forward to 1 second after end time */
      const transactionTime = await getBlockTimestamp(bidTx.blockNumber);
      await helpers.time.increaseTo(transactionTime + 86400 + 1);

      /* Claim with accountBidder1 */
      const claimTx = await collateralLiquidator.connect(accountBidder1).claim(nft1.address, 129, loanReceipt);

      /* Validate events */
      await expectEvent(claimTx, nft1, "Transfer", {
        from: collateralLiquidator.address,
        to: accountBidder1.address,
        tokenId: 129,
      });

      await expect(claimTx)
        .to.emit(collateralLiquidator, "AuctionEnded")
        .withArgs(liquidationHash, nft1.address, 129, accountBidder1.address, ethers.utils.parseEther("2"));

      await expect(claimTx)
        .to.emit(collateralLiquidator, "LiquidationEnded")
        .withArgs(liquidationHash, ethers.utils.parseEther("2"));

      await expectEvent(claimTx, tok1, "Transfer", {
        from: collateralLiquidator.address,
        to: accountBidder1.address,
        value: ethers.utils.parseEther("2"),
      });

      /* Validate state */
      const auction = await collateralLiquidator.auctions(nft1.address, 129);
      await expect(auction.endTime).to.equal(ethers.constants.Zero);

      const liquidation = await collateralLiquidator.liquidations(liquidationHash);
      await expect(liquidation.source).to.equal(ethers.constants.AddressZero);
      await expect(liquidation.proceeds).to.equal(ethers.constants.Zero);
      await expect(liquidation.auctionCount).to.equal(ethers.constants.Zero);
      await expect(liquidation.currencyToken).to.equal(ethers.constants.AddressZero);
      await expect(liquidation.liquidationContextHash).to.equal(ethers.constants.HashZero);
    });

    it("partial successful claim originating from a contract that does not implement onCollateralLiquidate", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 131, 0, "0x"));

      /* Calling liquidate() */
      const liquidateTx = await testCollateralLiquidatorJigTruncated.liquidate(loanReceipt);

      /* Get liquidationHash */
      const liquidationHash = (await extractEvent(liquidateTx, collateralLiquidator, "LiquidationStarted")).args[0];

      /* Bid with accountBidder1 */
      const bidTx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 131, ethers.utils.parseEther("2"));

      /* Fast forward to 1 second after end time */
      const transactionTime = await getBlockTimestamp(bidTx.blockNumber);
      await helpers.time.increaseTo(transactionTime + 86400 + 1);

      /* Claim with accountBidder1 */
      const claimTx = await collateralLiquidator.connect(accountBidder1).claim(nft1.address, 131, loanReceipt);

      /* Validate events */
      await expectEvent(claimTx, nft1, "Transfer", {
        from: collateralLiquidator.address,
        to: accountBidder1.address,
        tokenId: 131,
      });

      await expect(claimTx)
        .to.emit(collateralLiquidator, "AuctionEnded")
        .withArgs(liquidationHash, nft1.address, 131, accountBidder1.address, ethers.utils.parseEther("2"));

      await expect(claimTx)
        .to.emit(collateralLiquidator, "LiquidationEnded")
        .withArgs(liquidationHash, ethers.utils.parseEther("2"));

      await expectEvent(claimTx, tok1, "Transfer", {
        from: collateralLiquidator.address,
        to: testCollateralLiquidatorJigTruncated.address,
        value: ethers.utils.parseEther("2"),
      });

      /* Validate state */
      const auction = await collateralLiquidator.auctions(nft1.address, 122);
      await expect(auction.endTime).to.equal(ethers.constants.Zero);

      const liquidation = await collateralLiquidator.liquidations(liquidationHash);
      await expect(liquidation.source).to.equal(ethers.constants.AddressZero);
      await expect(liquidation.proceeds).to.equal(ethers.constants.Zero);
      await expect(liquidation.auctionCount).to.equal(ethers.constants.Zero);
      await expect(liquidation.currencyToken).to.equal(ethers.constants.AddressZero);
      await expect(liquidation.liquidationContextHash).to.equal(ethers.constants.HashZero);
    });

    it("fails when liquidation source contract reverts during onCollateralLiquidated", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 130, 0, "0x"));

      /* Calling liquidate() */
      const liquidateTx = await testCollateralLiquidatorJigRevert.liquidate(loanReceipt);

      /* Get liquidationHash */
      const liquidationHash = (await extractEvent(liquidateTx, collateralLiquidator, "AuctionCreated")).args[0];

      /* Bid with accountBidder1 */
      const bidTx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 130, ethers.utils.parseEther("2"));

      /* Fast forward to 1 second after end time */
      const transactionTime = await getBlockTimestamp(bidTx.blockNumber);
      await helpers.time.increaseTo(transactionTime + 86400 + 1);

      /* Claim with accountBidder1 */
      await expect(
        collateralLiquidator.connect(accountBidder1).claim(nft1.address, 130, loanReceipt)
      ).to.be.revertedWithCustomError(testCollateralLiquidatorJigRevert, "ForceRevert");
    });

    it("fails claim before end time", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Calling liquidate() */
      await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Bid with accountBidder1 */
      await collateralLiquidator.connect(accountBidder1).bid(nft1.address, 122, ethers.utils.parseEther("2"));

      /* Claim with accountBidder1 */
      await expect(
        collateralLiquidator.connect(accountBidder1).claim(nft1.address, 122, loanReceipt)
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidClaim");
    });

    it("fails claim before auction started", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Calling liquidate() */
      await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Claim with accountBidder1 */
      await expect(
        collateralLiquidator.connect(accountBidder1).claim(nft1.address, 122, loanReceipt)
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidClaim");
    });

    it("fails claim on invalid auction", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Claim fails with invalid auction */
      await expect(
        collateralLiquidator.connect(accountBidder1).claim(nft1.address, 122, loanReceipt)
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidAuction");
    });

    it("fails claim on invalid liquidation context", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Calling liquidate() */
      await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Bid with accountBidder1 */
      const bidTx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 122, ethers.utils.parseEther("2"));

      /* Fast forward to 1 second after end time */
      const transactionTime = await getBlockTimestamp(bidTx.blockNumber);
      await helpers.time.increaseTo(transactionTime + 86400 + 1);

      /* Claim fails with invalid liquidation context */
      await expect(
        collateralLiquidator.connect(accountBidder1).claim(nft1.address, 122, "0x112233")
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidClaim");
    });

    it("fails claim after successful claim before", async function () {
      /* Construct loan receipt */
      const loanReceipt = await loanReceiptLibrary.encode(makeLoanReceipt(nft1.address, 122, 0, "0x"));

      /* Calling liquidate() */
      await testCollateralLiquidatorJig.liquidate(loanReceipt);

      /* Bid with accountBidder1 */
      const bidTx = await collateralLiquidator
        .connect(accountBidder1)
        .bid(nft1.address, 122, ethers.utils.parseEther("2"));

      /* Fast forward to 1 second after end time */
      const transactionTime = await getBlockTimestamp(bidTx.blockNumber);
      await helpers.time.increaseTo(transactionTime + 86400 + 1);

      /* Claim successfully as accountBidder1 */
      await collateralLiquidator.connect(accountBidder1).claim(nft1.address, 122, loanReceipt);

      /* Claim with accountBidder1 */
      await expect(
        collateralLiquidator.connect(accountBidder1).claim(nft1.address, 122, loanReceipt)
      ).to.be.revertedWithCustomError(collateralLiquidator, "InvalidAuction");
    });
  });
});
