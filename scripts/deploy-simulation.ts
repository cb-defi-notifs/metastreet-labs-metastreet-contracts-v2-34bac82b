import { ethers } from "hardhat";

import { FixedPoint } from "../test/helpers/FixedPoint";
import { extractEvent } from "../test/helpers/EventUtilities";

async function main() {
  const accounts = await ethers.getSigners();
  console.log("Deploying from account #9 (%s)\n", accounts[9].address);

  const TestERC20 = await ethers.getContractFactory("TestERC20", accounts[9]);
  const TestERC721 = await ethers.getContractFactory("TestERC721", accounts[9]);
  const LiquidityManager = await ethers.getContractFactory("LiquidityManager");
  const CollectionCollateralFilter = await ethers.getContractFactory("CollectionCollateralFilter", accounts[9]);
  const FixedInterestRateModel = await ethers.getContractFactory("FixedInterestRateModel", accounts[9]);

  /* Deploy liquidity manager library */
  const liquidityManagerLib = await LiquidityManager.deploy();
  await liquidityManagerLib.deployed();

  /* Create Pool Factory */
  const PoolFactory = await ethers.getContractFactory("PoolFactory", {
    signer: accounts[9],
    libraries: { LiquidityManager: liquidityManagerLib.address },
  });

  /* Deploy Pool Factory */
  const poolFactory = await PoolFactory.deploy();
  console.log("Pool Factory:               ", poolFactory.address);

  console.log("");

  /* Deploy WETH */
  const wethTokenContract = await TestERC20.deploy("WETH", "WETH", 18, ethers.utils.parseEther("1000000"));
  await wethTokenContract.deployed();
  console.log("WETH ERC20 Contract:        ", wethTokenContract.address);

  /* Deploy BAYC */
  const baycTokenContract = await TestERC721.deploy(
    "BoredApeYachtClub",
    "BAYC",
    "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/"
  );
  await baycTokenContract.deployed();
  console.log("BAYC ERC721 Contract:       ", baycTokenContract.address);

  console.log("");

  /* Deploy Collection Collateral Filter Implementation */
  const collectionCollateralFilterImpl = await CollectionCollateralFilter.deploy();
  console.log("Collection Collateral Filter Impl:", collectionCollateralFilterImpl.address);

  /* Deploy Fixed Interest Rate Model Implementation */
  const fixedInterestRateModelImpl = await FixedInterestRateModel.deploy();
  console.log("Fixed Interest Rate Model Impl:", fixedInterestRateModelImpl.address);

  /* Create WETH Pool */
  const calldata = ethers.utils.defaultAbiCoder.encode(
    ["address", "uint64", "address", "address", "address", "bytes", "bytes"],
    [
      wethTokenContract.address,
      30 * 86400,
      collectionCollateralFilterImpl.address,
      fixedInterestRateModelImpl.address,
      ethers.constants.AddressZero,
      ethers.utils.defaultAbiCoder.encode(["address"], [baycTokenContract.address]),
      ethers.utils.defaultAbiCoder.encode(["uint256"], [FixedPoint.from("0.02")]),
    ]
  );
  const wethTestPoolCreationTx = await poolFactory.createPool(calldata);
  const wethTestPoolAddress = (await extractEvent(wethTestPoolCreationTx, poolFactory, "PoolCreated")).args.pool;
  console.log("WETH Test Pool:             ", wethTestPoolAddress);

  console.log("");

  console.log("Lender is        account #0 (%s)", accounts[0].address);
  console.log("Borrower is      account #1 (%s)", accounts[1].address);
  console.log("Depositer 1 is   account #2 (%s)", accounts[2].address);
  console.log("Depositer 2 is   account #3 (%s)", accounts[3].address);
  console.log("");

  await wethTokenContract.transfer(accounts[0].address, ethers.utils.parseEther("1000"));
  await wethTokenContract.transfer(accounts[1].address, ethers.utils.parseEther("1000"));
  await wethTokenContract.transfer(accounts[2].address, ethers.utils.parseEther("1000"));
  await wethTokenContract.transfer(accounts[3].address, ethers.utils.parseEther("1000"));
  console.log("Transferred 1000 WETH to account #0, #1, #2, #3");

  await baycTokenContract.mint(accounts[1].address, 123);
  await baycTokenContract.mint(accounts[1].address, 456);
  await baycTokenContract.mint(accounts[1].address, 768);
  console.log("Minted BAYC #123, #456, #768 to account #1");

  await baycTokenContract.connect(accounts[1]).setApprovalForAll(wethTestPoolAddress, true);
  console.log("Approved BAYC transfer for WETH Pool for account #1");

  await wethTokenContract.connect(accounts[1]).approve(wethTestPoolAddress, ethers.constants.MaxUint256);
  console.log("Approved WETH transfer for WETH Pool for account #1");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
