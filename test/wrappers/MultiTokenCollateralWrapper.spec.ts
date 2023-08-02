import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { TestERC20, TestERC1155, MultiTokenCollateralWrapper } from "../../typechain";

import { extractEvent, expectEvent } from "../helpers/EventUtilities";
import { BigNumber } from "ethers";

describe("MultiTokenCollateralWrapper", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let nft1: TestERC1155;
  let nft2: TestERC1155;
  let multiTokenCollateralWrapper: MultiTokenCollateralWrapper;
  let accountBorrower: SignerWithAddress;
  let snapshotId: string;

  before("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const testERC1155Factory = await ethers.getContractFactory("TestERC1155");
    const multiTokenCollateralWrapperFactory = await ethers.getContractFactory("MultiTokenCollateralWrapper");

    tok1 = (await testERC20Factory.deploy("Token 1", "TOK1", 18, ethers.utils.parseEther("1000"))) as TestERC20;
    await tok1.deployed();

    nft1 = (await testERC1155Factory.deploy("https://nft1.com/token/")) as TestERC1155;
    await nft1.deployed();

    nft2 = (await testERC1155Factory.deploy("https://nft2.com/token/")) as TestERC1155;
    await nft2.deployed();

    multiTokenCollateralWrapper = (await multiTokenCollateralWrapperFactory.deploy()) as MultiTokenCollateralWrapper;
    await multiTokenCollateralWrapper.deployed();

    accountBorrower = accounts[1];

    /* Mint NFTs to borrower */
    await nft1.mintBatch(accountBorrower.address, [123, 124, 125], [1, 2, 30], "0x");
    await nft2.mintBatch(accountBorrower.address, [126, 127, 128], [1, 2, 3], "0x");

    /* Approve batch token to transfer NFTs */
    await nft1.connect(accountBorrower).setApprovalForAll(multiTokenCollateralWrapper.address, true);
    await nft2.connect(accountBorrower).setApprovalForAll(multiTokenCollateralWrapper.address, true);
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
      expect(await multiTokenCollateralWrapper.IMPLEMENTATION_VERSION()).to.equal("1.0");
    });
    it("returns correct name", async function () {
      expect(await multiTokenCollateralWrapper.name()).to.equal("MetaStreet Multi Token Collateral Wrapper");
    });
    it("returns correct symbol", async function () {
      expect(await multiTokenCollateralWrapper.symbol()).to.equal("MSMTCW");
    });
  });

  /****************************************************************************/
  /* Primary API */
  /****************************************************************************/

  describe("#enumerate", async function () {
    it("enumerate batch", async function () {
      /* Mint batch */
      const mintTx1 = await multiTokenCollateralWrapper
        .connect(accountBorrower)
        .mint(nft1.address, [123, 124, 125], [1, 2, 3]);

      /* Get token id */
      const tokenId1 = (await extractEvent(mintTx1, multiTokenCollateralWrapper, "BatchMinted")).args.tokenId;

      /* Create context */
      const context = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256", "uint256", "uint256[]", "uint256[]"],
        [nft1.address, 0, 6, [123, 124, 125], [1, 2, 3]]
      );

      /* Enumerate */
      const [token, tokenIds] = await multiTokenCollateralWrapper.enumerate(tokenId1, context);

      /* Validate return */
      expect(token).to.equal(nft1.address);
      expect(tokenIds[0]).to.equal(123);
      expect(tokenIds[1]).to.equal(124);
      expect(tokenIds[2]).to.equal(124);
      expect(tokenIds[3]).to.equal(125);
      expect(tokenIds[4]).to.equal(125);
      expect(tokenIds[5]).to.equal(125);
    });

    it("fails on incorrect tokenId", async function () {
      /* Mint batch */
      await multiTokenCollateralWrapper.connect(accountBorrower).mint(nft1.address, [123, 124, 125], [1, 2, 3]);
      /* Use different token id */
      const badTokenId = BigNumber.from(
        "80530570786821071483259871300278421257638987008682429097249700923201294947214"
      );

      /* Create context */
      const context = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256", "uint256", "uint256[]", "uint256[]"],
        [nft1.address, 0, 6, [123, 124, 125], [1, 2, 3]]
      );

      await expect(multiTokenCollateralWrapper.enumerate(badTokenId, context)).to.be.revertedWithCustomError(
        multiTokenCollateralWrapper,
        "InvalidContext"
      );
    });
  });

  describe("#mint", async function () {
    it("mints batch", async function () {
      /* Mint 2 batch */
      const mintTx1 = await multiTokenCollateralWrapper
        .connect(accountBorrower)
        .mint(nft1.address, [123, 124, 125], [1, 2, 3]);
      const mintTx2 = await multiTokenCollateralWrapper
        .connect(accountBorrower)
        .mint(nft2.address, [126, 127, 128], [1, 2, 3]);

      /* Get token id */
      const tokenId1 = (await extractEvent(mintTx1, multiTokenCollateralWrapper, "BatchMinted")).args.tokenId;
      const tokenId2 = (await extractEvent(mintTx2, multiTokenCollateralWrapper, "BatchMinted")).args.tokenId;

      /* Validate events */
      await expectEvent(mintTx1, multiTokenCollateralWrapper, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountBorrower.address,
        tokenId: tokenId1,
      });

      await expectEvent(mintTx1, multiTokenCollateralWrapper, "BatchMinted", {
        tokenId: tokenId1,
        encodedBatch: ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "uint256", "uint256[]", "uint256[]"],
          [nft1.address, 0, 6, [123, 124, 125], [1, 2, 3]]
        ),
        account: accountBorrower.address,
      });

      await expectEvent(mintTx2, multiTokenCollateralWrapper, "Transfer", {
        from: ethers.constants.AddressZero,
        to: accountBorrower.address,
        tokenId: tokenId2,
      });

      await expectEvent(mintTx2, multiTokenCollateralWrapper, "BatchMinted", {
        tokenId: tokenId2,
        encodedBatch: ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "uint256", "uint256[]", "uint256[]"],
          [nft2.address, 1, 6, [126, 127, 128], [1, 2, 3]]
        ),
        account: accountBorrower.address,
      });

      /* Validate state */
      expect(await multiTokenCollateralWrapper.exists(tokenId1)).to.equal(true);
      expect(await multiTokenCollateralWrapper.exists(tokenId2)).to.equal(true);
      expect(await multiTokenCollateralWrapper.ownerOf(tokenId1)).to.equal(accountBorrower.address);
      expect(await multiTokenCollateralWrapper.ownerOf(tokenId2)).to.equal(accountBorrower.address);

      expect(await nft1.balanceOf(multiTokenCollateralWrapper.address, 123)).to.equal(1);
      expect(await nft1.balanceOf(multiTokenCollateralWrapper.address, 124)).to.equal(2);
      expect(await nft1.balanceOf(multiTokenCollateralWrapper.address, 125)).to.equal(3);
      expect(await nft2.balanceOf(multiTokenCollateralWrapper.address, 126)).to.equal(1);
      expect(await nft2.balanceOf(multiTokenCollateralWrapper.address, 127)).to.equal(2);
      expect(await nft2.balanceOf(multiTokenCollateralWrapper.address, 128)).to.equal(3);
    });

    it("mints batch size 32", async function () {
      /* Mint batch */
      await multiTokenCollateralWrapper.connect(accountBorrower).mint(nft1.address, [123, 124, 125], [1, 2, 29]);
    });

    it("can transfer MultiTokenCollateralWrapperToken", async function () {
      /* Mint batch */
      const mintTx1 = await multiTokenCollateralWrapper
        .connect(accountBorrower)
        .mint(nft1.address, [123, 124, 125], [1, 2, 3]);

      /* Get token id */
      const tokenId1 = (await extractEvent(mintTx1, multiTokenCollateralWrapper, "BatchMinted")).args.tokenId;

      /* Validate owner */
      expect(await multiTokenCollateralWrapper.ownerOf(tokenId1)).to.equal(accountBorrower.address);

      /* Transfer token */
      await multiTokenCollateralWrapper
        .connect(accountBorrower)
        .transferFrom(accountBorrower.address, accounts[2].address, tokenId1);

      /* Validate owner */
      expect(await multiTokenCollateralWrapper.ownerOf(tokenId1)).to.equal(accounts[2].address);
    });

    it("fails on non-existent nft", async function () {
      await expect(
        multiTokenCollateralWrapper.connect(accountBorrower).mint(nft1.address, [123, 1000], [1, 2])
      ).to.be.revertedWith("ERC1155: insufficient balance for transfer");
    });

    it("fails on empty list of token ids and multipliers", async function () {
      await expect(
        multiTokenCollateralWrapper.connect(accountBorrower).mint(nft1.address, [], [])
      ).to.be.revertedWithCustomError(multiTokenCollateralWrapper, "InvalidSize");
    });

    it("fails on non-equal token ids and multipliers", async function () {
      await expect(
        multiTokenCollateralWrapper.connect(accountBorrower).mint(nft1.address, [123, 124], [1])
      ).to.be.revertedWithCustomError(multiTokenCollateralWrapper, "InvalidSize");
    });

    it("fails on batch size 33", async function () {
      await expect(
        multiTokenCollateralWrapper.connect(accountBorrower).mint(nft1.address, [123, 124, 125], [1, 2, 30])
      ).to.be.revertedWithCustomError(multiTokenCollateralWrapper, "InvalidSize");
    });

    it("fails on non-increasing token ids", async function () {
      await expect(
        multiTokenCollateralWrapper.connect(accountBorrower).mint(nft1.address, [124, 123, 125], [1, 1, 1])
      ).to.be.revertedWithCustomError(multiTokenCollateralWrapper, "InvalidOrdering");

      await expect(
        multiTokenCollateralWrapper.connect(accountBorrower).mint(nft1.address, [124, 125, 125], [1, 1, 1])
      ).to.be.revertedWithCustomError(multiTokenCollateralWrapper, "InvalidOrdering");
    });
  });

  describe("#unwrap", async function () {
    it("unwrap batch", async function () {
      /* Mint batch */
      const mintTx1 = await multiTokenCollateralWrapper
        .connect(accountBorrower)
        .mint(nft1.address, [123, 124, 125], [1, 2, 3]);

      /* Get token id */
      const tokenId1 = (await extractEvent(mintTx1, multiTokenCollateralWrapper, "BatchMinted")).args.tokenId;

      /* Create context */
      const context = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256", "uint256", "uint256[]", "uint256[]"],
        [nft1.address, 0, 6, [123, 124, 125], [1, 2, 3]]
      );

      /* Validate current owner */
      expect(await multiTokenCollateralWrapper.ownerOf(tokenId1)).to.equal(accountBorrower.address);

      /* Unwrap and validate events */
      await expect(multiTokenCollateralWrapper.connect(accountBorrower).unwrap(tokenId1, context))
        .to.emit(multiTokenCollateralWrapper, "Transfer")
        .withArgs(accountBorrower.address, ethers.constants.AddressZero, tokenId1)
        .to.emit(nft1, "TransferBatch")
        .withArgs(
          multiTokenCollateralWrapper.address,
          multiTokenCollateralWrapper.address,
          accountBorrower.address,
          [123, 124, 125],
          [1, 2, 3]
        )
        .to.emit(multiTokenCollateralWrapper, "BatchUnwrapped")
        .withArgs(tokenId1, accountBorrower.address);

      expect(await multiTokenCollateralWrapper.exists(tokenId1)).to.equal(false);

      expect(await nft1.balanceOf(accountBorrower.address, 123)).to.equal(1);
      expect(await nft1.balanceOf(accountBorrower.address, 124)).to.equal(2);
      expect(await nft1.balanceOf(accountBorrower.address, 125)).to.equal(30);
      expect(await nft1.balanceOf(multiTokenCollateralWrapper.address, 123)).to.equal(0);
      expect(await nft1.balanceOf(multiTokenCollateralWrapper.address, 124)).to.equal(0);
      expect(await nft1.balanceOf(multiTokenCollateralWrapper.address, 125)).to.equal(0);
    });

    it("only token holder can unwrap batch", async function () {
      /* Mint batch */
      const mintTx1 = await multiTokenCollateralWrapper
        .connect(accountBorrower)
        .mint(nft1.address, [123, 124, 125], [1, 2, 3]);

      /* Get token id */
      const tokenId1 = (await extractEvent(mintTx1, multiTokenCollateralWrapper, "BatchMinted")).args.tokenId;

      /* Create context */
      const context = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256", "uint256", "uint256[]", "uint256[]"],
        [nft1.address, 0, 6, [123, 124, 125], [1, 2, 3]]
      );

      /* Validate current owner */
      expect(await multiTokenCollateralWrapper.ownerOf(tokenId1)).to.equal(accountBorrower.address);

      /* Attempt to unwrap */
      await expect(
        multiTokenCollateralWrapper.connect(accounts[2]).unwrap(tokenId1, context)
      ).to.be.revertedWithCustomError(multiTokenCollateralWrapper, "InvalidCaller");

      await expect(multiTokenCollateralWrapper.unwrap(tokenId1, context)).to.be.revertedWithCustomError(
        multiTokenCollateralWrapper,
        "InvalidCaller"
      );
    });

    it("fails on incorrect tokenId", async function () {
      /* Mint batch */
      const mintTx1 = await multiTokenCollateralWrapper
        .connect(accountBorrower)
        .mint(nft1.address, [123, 124, 125], [1, 2, 3]);

      /* Use bad token id */
      const badTokenId = BigNumber.from(
        "80530570786821071483259871300278421257638987008682429097249700923201294947214"
      );

      /* Create context */
      const context = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256", "uint256", "uint256[]", "uint256[]"],
        [nft1.address, 0, 6, [123, 124, 125], [1, 2, 3]]
      );

      /* Attempt to unwrap */
      await expect(
        multiTokenCollateralWrapper.connect(accountBorrower).unwrap(badTokenId, context)
      ).to.be.revertedWithCustomError(multiTokenCollateralWrapper, "InvalidContext");
    });

    it("transferee can unwrap batch", async function () {
      /* Mint batch */
      const mintTx1 = await multiTokenCollateralWrapper
        .connect(accountBorrower)
        .mint(nft1.address, [123, 124, 125], [1, 2, 3]);

      /* Get token id */
      const tokenId1 = (await extractEvent(mintTx1, multiTokenCollateralWrapper, "BatchMinted")).args.tokenId;

      /* Validate owner */
      expect(await multiTokenCollateralWrapper.ownerOf(tokenId1)).to.equal(accountBorrower.address);

      /* Transfer token */
      await multiTokenCollateralWrapper
        .connect(accountBorrower)
        .transferFrom(accountBorrower.address, accounts[2].address, tokenId1);

      /* Validate owner */
      expect(await multiTokenCollateralWrapper.ownerOf(tokenId1)).to.equal(accounts[2].address);

      /* Create context */
      const context = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256", "uint256", "uint256[]", "uint256[]"],
        [nft1.address, 0, 6, [123, 124, 125], [1, 2, 3]]
      );

      /* Unwrap and validate events */
      await expect(multiTokenCollateralWrapper.connect(accounts[2]).unwrap(tokenId1, context))
        .to.emit(multiTokenCollateralWrapper, "Transfer")
        .withArgs(accounts[2].address, ethers.constants.AddressZero, tokenId1)
        .to.emit(nft1, "TransferBatch")
        .withArgs(
          multiTokenCollateralWrapper.address,
          multiTokenCollateralWrapper.address,
          accounts[2].address,
          [123, 124, 125],
          [1, 2, 3]
        )
        .to.emit(multiTokenCollateralWrapper, "BatchUnwrapped")
        .withArgs(tokenId1, accounts[2].address);

      expect(await multiTokenCollateralWrapper.exists(tokenId1)).to.equal(false);

      expect(await nft1.balanceOf(accounts[2].address, 123)).to.equal(1);
      expect(await nft1.balanceOf(accounts[2].address, 124)).to.equal(2);
      expect(await nft1.balanceOf(accounts[2].address, 125)).to.equal(3);
      expect(await nft1.balanceOf(accountBorrower.address, 123)).to.equal(0);
      expect(await nft1.balanceOf(accountBorrower.address, 124)).to.equal(0);
      expect(await nft1.balanceOf(accountBorrower.address, 125)).to.equal(27);
    });
  });

  /****************************************************************************/
  /* ERC165 Interface */
  /****************************************************************************/

  describe("#supportsInterface", async function () {
    it("returns true on supported interfaces", async function () {
      /* ERC165 */
      expect(
        await multiTokenCollateralWrapper.supportsInterface(
          multiTokenCollateralWrapper.interface.getSighash("supportsInterface")
        )
      ).to.equal(true);

      /* ICollateralWrapper */
      expect(
        await multiTokenCollateralWrapper.supportsInterface(
          ethers.utils.hexlify(
            ethers.BigNumber.from(multiTokenCollateralWrapper.interface.getSighash("name"))
              .xor(ethers.BigNumber.from(multiTokenCollateralWrapper.interface.getSighash("unwrap")))
              .xor(ethers.BigNumber.from(multiTokenCollateralWrapper.interface.getSighash("enumerate")))
          )
        )
      ).to.equal(true);

      /* IERC721 */
      expect(await multiTokenCollateralWrapper.supportsInterface("0x80ac58cd")).to.equal(true);

      /* IERC1155Receiver */
      expect(
        await multiTokenCollateralWrapper.supportsInterface(
          ethers.utils.hexlify(
            ethers.BigNumber.from(multiTokenCollateralWrapper.interface.getSighash("onERC1155BatchReceived")).xor(
              ethers.BigNumber.from(multiTokenCollateralWrapper.interface.getSighash("onERC1155Received"))
            )
          )
        )
      ).to.equal(true);

      it("returns false on unsupported interfaces", async function () {
        expect(await multiTokenCollateralWrapper.supportsInterface("0xaabbccdd")).to.equal(false);
        expect(await multiTokenCollateralWrapper.supportsInterface("0x00000000")).to.equal(false);
        expect(await multiTokenCollateralWrapper.supportsInterface("0xffffffff")).to.equal(false);
      });
    });
  });
});
