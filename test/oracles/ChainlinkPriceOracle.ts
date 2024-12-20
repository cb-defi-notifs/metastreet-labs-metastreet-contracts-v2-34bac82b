import { expect } from "chai";
import { ethers, network } from "hardhat";

import { ChainlinkPriceOracle } from "../../typechain";
import { FixedPoint } from "../helpers/FixedPoint";

describe("ChainlinkPriceOracle", function () {
  let chainlinkPriceOracle: ChainlinkPriceOracle;
  let snapshotId: string;

  /* Constants */
  const BTCUSD_FEED_ADDRESS = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
  const ETHUSD_FEED_ADDRESS = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const BLOCK_ID = 21446746;

  before("deploy fixture", async function () {
    /* Skip test if no MAINNET_URL env variable */
    if (!process.env.MAINNET_URL) {
      this.skip();
    }

    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber: BLOCK_ID,
          },
        },
      ],
    });

    const chainlinkPriceOracleFactory = await ethers.getContractFactory("ChainlinkPriceOracle");

    chainlinkPriceOracle = (await chainlinkPriceOracleFactory.deploy(
      BTCUSD_FEED_ADDRESS,
      ETHUSD_FEED_ADDRESS
    )) as ChainlinkPriceOracle;
    chainlinkPriceOracle.waitForDeployment();
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
    it("matches price oracle implementation version", async function () {
      expect(await chainlinkPriceOracle.IMPLEMENTATION_VERSION()).to.be.equal("1.0");
    });
    it("matches base feed", async function () {
      expect(await chainlinkPriceOracle.basePriceFeed()).to.be.equal(BTCUSD_FEED_ADDRESS);
    });
    it("matches quote feed", async function () {
      expect(await chainlinkPriceOracle.quotePriceFeed()).to.be.equal(ETHUSD_FEED_ADDRESS);
    });
  });

  /****************************************************************************/
  /* Primary API */
  /****************************************************************************/

  describe("#price", async function () {
    it("successfully returns price", async function () {
      expect(await chainlinkPriceOracle.price(ethers.ZeroAddress, WETH_ADDRESS, [], [], "0x")).to.be.equal(
        27930590133192754923n
      );
    });
  });
});
