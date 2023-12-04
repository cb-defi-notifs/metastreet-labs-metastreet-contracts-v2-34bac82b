import { expect } from "chai";
import { ethers, network } from "hardhat";

import { ReservoirPriceOracle } from "../../typechain";
import { FixedPoint } from "../helpers/FixedPoint";

describe("ReservoirPriceOracle", function () {
  let reservoirPriceOracle: ReservoirPriceOracle;
  let snapshotId: string;

  /* API Response for Wrapped Cryptopunks
    {
      "price": 55.25,
      "message": {
        "id": "0xa3cba788f3b64d956bbb74dad453d6aabfce23ee7a708f5e75bd7f5d1822d366",
        "payload": "0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000002febf6e45e0550000",
        "timestamp": 1702585739,
        "chainId": "1",
        "signature": "0xe6d145029c51c0d96865e093081af976dec51acdf284d86c396824f34d6eca7a31f2c053bdf80da435aa32d3d517bc8325a866233a5494e48b3485647aadb9ee1b"
      },
      "data": "0x0000000000000000000000000000000000000000000000000000000000000020a3cba788f3b64d956bbb74dad453d6aabfce23ee7a708f5e75bd7f5d1822d366000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000657b658b00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000002febf6e45e05500000000000000000000000000000000000000000000000000000000000000000041e6d145029c51c0d96865e093081af976dec51acdf284d86c396824f34d6eca7a31f2c053bdf80da435aa32d3d517bc8325a866233a5494e48b3485647aadb9ee1b00000000000000000000000000000000000000000000000000000000000000"
    }
  */
  const RESERVOIR_MESSAGE_CALLDATA =
    "0x0000000000000000000000000000000000000000000000000000000000000020a3cba788f3b64d956bbb74dad453d6aabfce23ee7a708f5e75bd7f5d1822d366000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000657b658b00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000002febf6e45e05500000000000000000000000000000000000000000000000000000000000000000041e6d145029c51c0d96865e093081af976dec51acdf284d86c396824f34d6eca7a31f2c053bdf80da435aa32d3d517bc8325a866233a5494e48b3485647aadb9ee1b00000000000000000000000000000000000000000000000000000000000000";

  /* API Response for Wrapped Cryptopunks with invalid useNonFlaggedFloorAsk flag
    {
      "price": 55.25,
      "message": {
        "id": "0x257fa0307fd95fe28124ea8d2114b519ad4e2e017f222cd878130efa02f229b1",
        "payload": "0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000002febf6e45e0550000",
        "timestamp": 1702585763,
        "chainId": "1",
        "signature": "0x8cb9c1a1a8c7cda1de35ab5b702c05aff5db846a70ccdd75aa692b2f544d1dae322988f49fe6185cf1c046a840e7f073a2ce231ba62054a8b244fa40418314741c"
      },
      "data": "0x0000000000000000000000000000000000000000000000000000000000000020257fa0307fd95fe28124ea8d2114b519ad4e2e017f222cd878130efa02f229b1000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000657b65a300000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000002febf6e45e055000000000000000000000000000000000000000000000000000000000000000000418cb9c1a1a8c7cda1de35ab5b702c05aff5db846a70ccdd75aa692b2f544d1dae322988f49fe6185cf1c046a840e7f073a2ce231ba62054a8b244fa40418314741c00000000000000000000000000000000000000000000000000000000000000"
    }
  */
  const RESERVOIR_MESSAGE_INVALID_FLAG_CALLDATA =
    "0x0000000000000000000000000000000000000000000000000000000000000020257fa0307fd95fe28124ea8d2114b519ad4e2e017f222cd878130efa02f229b1000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000657b65a300000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000002febf6e45e055000000000000000000000000000000000000000000000000000000000000000000418cb9c1a1a8c7cda1de35ab5b702c05aff5db846a70ccdd75aa692b2f544d1dae322988f49fe6185cf1c046a840e7f073a2ce231ba62054a8b244fa40418314741c00000000000000000000000000000000000000000000000000000000000000";

  /* API Response for Wrapped Cryptopunks with invalid timestamp
    {
      "price": 55.25,
      "message": {
        "id": "0xa3cba788f3b64d956bbb74dad453d6aabfce23ee7a708f5e75bd7f5d1822d366",
        "payload": "0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000002febf6e45e0550000",
        "timestamp": 1702581995,
        "chainId": "1",
        "signature": "0x4216f6b018d1a20821ac9b8df64ba5e94abdba949d407d95c2572e354352271968a70c32690e1bb1ed62c568ce0c2cbaf9bdb5a9e88fd88d3d360707178a0edb1b"
      },
      "data": "0x0000000000000000000000000000000000000000000000000000000000000020a3cba788f3b64d956bbb74dad453d6aabfce23ee7a708f5e75bd7f5d1822d366000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000657b56eb00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000002febf6e45e055000000000000000000000000000000000000000000000000000000000000000000414216f6b018d1a20821ac9b8df64ba5e94abdba949d407d95c2572e354352271968a70c32690e1bb1ed62c568ce0c2cbaf9bdb5a9e88fd88d3d360707178a0edb1b00000000000000000000000000000000000000000000000000000000000000"
    }
  */
  const RESERVOIR_MESSAGE_INVALID_TIMESTAMP_CALLDATA =
    "0x0000000000000000000000000000000000000000000000000000000000000020a3cba788f3b64d956bbb74dad453d6aabfce23ee7a708f5e75bd7f5d1822d366000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000657b56eb00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000002febf6e45e055000000000000000000000000000000000000000000000000000000000000000000414216f6b018d1a20821ac9b8df64ba5e94abdba949d407d95c2572e354352271968a70c32690e1bb1ed62c568ce0c2cbaf9bdb5a9e88fd88d3d360707178a0edb1b00000000000000000000000000000000000000000000000000000000000000";

  /* API Response for Wrapped Cryptopunks with invalid signer
    {
      "price": 55.25,
      "message": {
        "id": "0xa3cba788f3b64d956bbb74dad453d6aabfce23ee7a708f5e75bd7f5d1822d366",
        "payload": "0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000002febf6e45e0550000",
        "timestamp": 1702585787,
        "chainId": "1",
        "signature": "0x674bfadaf23831df2695a4f0f000ef069973091b1d3c6c924959a53c741e315b07c2d5410f7f21d64701bff34f8a5901a7635d7e7ea4aa189e3721e0481d23aa1b"
      },
      "data": "0x0000000000000000000000000000000000000000000000000000000000000020a3cba788f3b64d956bbb74dad453d6aabfce23ee7a708f5e75bd7f5d1822d366000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000657b65bb00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000002febf6e45e05500000000000000000000000000000000000000000000000000000000000000000041674bfadaf23831df2695a4f0f000ef069973091b1d3c6c924959a53c741e315b07c2d5410f7f21d64701bff34f8a5901a7635d7e7ea4aa189e3721e0481d23aa1b00000000000000000000000000000000000000000000000000000000000000"
    }
  */
  const RESERVOIR_MESSAGE_INVALID_SIGNER_CALLDATA =
    "0x0000000000000000000000000000000000000000000000000000000000000020a3cba788f3b64d956bbb74dad453d6aabfce23ee7a708f5e75bd7f5d1822d366000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000657b65bb00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000002febf6e45e05500000000000000000000000000000000000000000000000000000000000000000041674bfadaf23831df2695a4f0f000ef069973091b1d3c6c924959a53c741e315b07c2d5410f7f21d64701bff34f8a5901a7635d7e7ea4aa189e3721e0481d23aa1b00000000000000000000000000000000000000000000000000000000000000";

  /* Constants */
  const WPUNKS_ADDRESS = "0xb7F7F6C52F2e2fdb1963Eab30438024864c313F6";
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const BLOCK_ID = 18786767;

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

    const reservoirPriceOracleFactory = await ethers.getContractFactory("ReservoirPriceOracle");

    reservoirPriceOracle = (await reservoirPriceOracleFactory.deploy(
      5 * 60, // 5 minutes
      2, // LOWER min(Spot,TWAP)
      86400, // 24 hours
      true // only non-flagged tokens
    )) as ReservoirPriceOracle;
    reservoirPriceOracle.deployed();
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
      expect(await reservoirPriceOracle.IMPLEMENTATION_VERSION()).to.be.equal("1.0");
    });

    it("matches price oracle API version", async function () {
      expect(await reservoirPriceOracle.RESERVOIR_API_VERSION()).to.be.equal("v6");
    });
  });

  /****************************************************************************/
  /* Primary API */
  /****************************************************************************/

  describe("#price", async function () {
    it("successfully return price", async function () {
      expect(
        await reservoirPriceOracle.price(WPUNKS_ADDRESS, WETH_ADDRESS, [], [], RESERVOIR_MESSAGE_CALLDATA)
      ).to.be.equal(FixedPoint.from("55.25"));
    });

    it("fails on invalid flag / message ID", async function () {
      await expect(
        reservoirPriceOracle.price(WPUNKS_ADDRESS, WETH_ADDRESS, [], [], RESERVOIR_MESSAGE_INVALID_FLAG_CALLDATA)
      ).to.be.revertedWithCustomError(reservoirPriceOracle, "InvalidMessageId");
    });

    it("fails on invalid currency", async function () {
      await expect(
        reservoirPriceOracle.price(WPUNKS_ADDRESS, USDC_ADDRESS, [], [], RESERVOIR_MESSAGE_CALLDATA)
      ).to.be.revertedWithCustomError(reservoirPriceOracle, "InvalidCurrency");
    });

    it("fails on invalid timestamp", async function () {
      await expect(
        reservoirPriceOracle.price(WPUNKS_ADDRESS, WETH_ADDRESS, [], [], RESERVOIR_MESSAGE_INVALID_TIMESTAMP_CALLDATA)
      ).to.be.revertedWithCustomError(reservoirPriceOracle, "InvalidTimestamp");
    });

    it("fails on invalid signer", async function () {
      await expect(
        reservoirPriceOracle.price(WPUNKS_ADDRESS, WETH_ADDRESS, [], [], RESERVOIR_MESSAGE_INVALID_SIGNER_CALLDATA)
      ).to.be.revertedWithCustomError(reservoirPriceOracle, "InvalidSigner");
    });
  });
});
