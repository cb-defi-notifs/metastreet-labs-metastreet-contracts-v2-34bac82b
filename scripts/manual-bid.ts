/* eslint-disable camelcase */
import { ethers } from "hardhat";

async function main() {
  // Set up
  const accounts = await ethers.getSigners();
  const account = accounts[0];

  const poolImpl = await ethers.getContractFactory("WeightedRateCollectionPool");
  let Pool;
  if (process.env.POOL_ADDRESS) {
    Pool = await poolImpl.attach(process.env.POOL_ADDRESS);
  }

  const auctionImpl = await ethers.getContractFactory("EnglishAuctionCollateralLiquidator");
  let Auction;
  if (process.env.LIQUIDATOR_ADDRESS) {
    Auction = await auctionImpl.attach(process.env.LIQUIDATOR_ADDRESS);
  }

  const tokenImpl = await ethers.getContractFactory("TestERC20");
  let Token;
  if (process.env.WETH_ADDRESS) {
    Token = await tokenImpl.attach(process.env.WETH_ADDRESS);
  }

  const eventSignature: string = "LoanOriginated(bytes32,bytes)";
  const eventTopic: string = ethers.utils.id(eventSignature); // Get the data hex string

  const rawLogs = await ethers.provider.getLogs({
    address: process.env.POOL_ADDRESS,
    topics: [eventTopic],
    fromBlock: process.env.BLOCK_NUMBER,
    toBlock: process.env.BLOCK_NUMBER,
  });

  let decodedLoanReceipt;
  let encodedLoanReceipt;

  for (let rawLog of rawLogs) {
    if (rawLog["transactionHash"] === process.env.TX_HASH && Pool) {
      encodedLoanReceipt = ethers.utils.defaultAbiCoder.decode(["bytes"], rawLog["data"])[0];
      decodedLoanReceipt = await Pool.decodeLoanReceipt(encodedLoanReceipt);
    }
  }

  // Bid
  if (process.env.LIQUIDATOR_ADDRESS && process.env.BID_AMOUNT_WEI && Token) {
    const approveTx = await Token.connect(account).approve(process.env.LIQUIDATOR_ADDRESS, process.env.BID_AMOUNT_WEI);
    console.log("approveTx:", approveTx);
  }

  if (decodedLoanReceipt && process.env.BID_AMOUNT_WEI && Auction) {
    const bidTx = await Auction.connect(account).bid(
      decodedLoanReceipt.collateralToken,
      decodedLoanReceipt.collateralTokenId,
      process.env.BID_AMOUNT_WEI
    );
    console.log("bidTx:", bidTx);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
