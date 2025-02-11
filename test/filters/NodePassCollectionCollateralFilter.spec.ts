import { expect } from "chai";
import { ethers, network } from "hardhat";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import { NodePassCollectionCollateralFilter } from "../../typechain";

describe("NodePassCollectionCollateralFilter", function () {
  let collateralFilter: TestNodePassCollectionCollateralFilter;
  let snapshotId: string;

  /* Arbitrum sepolia block height */
  const BLOCK_HEIGHT = 123310800;

  /* Arbitrum sepolia yield pass factory */
  const YIELD_PASS_FACTORY = "0x545b5e69a3EAf36E68109d94160B349004BC3aC3";

  /* Arbitrum sepolia node token */
  const NODE_TOKEN = "0x3fa2E78429646cEB37d9895947D0611589327035";

  /* Arbitrum sepolia node pass */
  const NODE_PASS = "0x0aF8A8268F4cDd6ACe754904E42025f578372233";

  before("fork testnet and deploy fixture", async function () {
    /* Skip test if no ARBITRUM_SEPOLIA_URL env variable */
    if (!process.env.ARBITRUM_SEPOLIA_URL) {
      this.skip();
    }

    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ARBITRUM_SEPOLIA_URL,
            blockNumber: BLOCK_HEIGHT,
          },
        },
      ],
    });

    const NodePassCollectionCollateralFilterFactory = await ethers.getContractFactory(
      "TestNodePassCollectionCollateralFilter"
    );

    collateralFilter = await NodePassCollectionCollateralFilterFactory.deploy(YIELD_PASS_FACTORY, NODE_TOKEN);
    await collateralFilter.waitForDeployment();
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
    it("matches expected name", async function () {
      expect(await collateralFilter.COLLATERAL_FILTER_NAME()).to.equal("NodePassCollectionCollateralFilter");
    });
    it("matches expected implementation version", async function () {
      expect(await collateralFilter.COLLATERAL_FILTER_VERSION()).to.equal("1.0");
    });
  });

  /****************************************************************************/
  /* Getters */
  /****************************************************************************/

  describe("#collateralToken", async function () {
    it("matches expected collateral token", async function () {
      expect(await collateralFilter.collateralToken()).to.equal(NODE_TOKEN);
    });
    it("matches expected collateral tokens", async function () {
      expect(await collateralFilter.collateralTokens()).to.be.eql([NODE_TOKEN]);
    });
  });

  /****************************************************************************/
  /* Primary API */
  /****************************************************************************/

  describe("#collateralSupported", async function () {
    it("matches supported token", async function () {
      /* Valid yield pass */
      expect(await collateralFilter.collateralSupported(NODE_PASS, 123, 0, "0x")).to.equal(true);

      /* Invalid yield pass */
      await expect(collateralFilter.collateralSupported("0x1111111111111111111111111111111111111111", 123, 0, "0x")).to
        .be.reverted;

      /* Wrong node token */
      expect(
        await collateralFilter.collateralSupported("0x50d06b96cfCCa8f1F76C9e5FDB5f6870b36bCBc2", 123, 0, "0x")
      ).to.equal(false);
      /* Expired node token */
      await helpers.time.increase(86400 * 10);
      expect(await collateralFilter.collateralSupported(NODE_PASS, 123, 0, "0x")).to.equal(false);
    });
  });
});
