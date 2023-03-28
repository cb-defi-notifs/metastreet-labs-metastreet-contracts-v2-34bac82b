import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import {
  TestERC20,
  TestERC721,
  TestLoanReceipt,
  TestDelegationRegistry,
  FixedInterestRateModel,
  CollectionCollateralFilter,
  ExternalCollateralLiquidator,
  Pool,
} from "../typechain";

import { extractEvent } from "./helpers/EventUtilities";
import { elapseUntilTimestamp } from "./helpers/BlockchainUtilities";
import { FixedPoint } from "./helpers/FixedPoint.ts";
import { PoolModel } from "./integration/PoolModel";

describe("Integration", function () {
  let accounts: SignerWithAddress[];
  let tok1: TestERC20;
  let nft1: TestERC721;
  let loanReceiptLib: TestLoanReceipt;
  let collateralFilterImpl: CollectionCollateralFilter;
  let interestRateModelImpl: FixedInterestRateModel;
  let collateralLiquidatorImpl: ExternalCollateralLiquidator;
  let collateralLiquidator: ExternalCollateralLiquidator;
  let poolImpl: Pool;
  let pool: Pool;
  let poolModel: PoolModel;
  let snapshotId: string;
  let accountDepositors: SignerWithAddress[9];
  let accountBorrowers: SignerWithAddress[10];
  let accountLender: SignerWithAddress;
  let delegationRegistry: TestDelegationRegistry;

  // test config
  const CONFIG = {
    functionCalls: [deposit, borrow, repay, refinance, redeem, withdraw],
    maxFunctionCalls: 1000,
    principals: [1, 2], // min: 1 ethers, max: 100 ethers
    durations: [1, 30 * 86400], // min: 1 second, max: 30 * 86499 seconds
    depths: ["1", "2", "5", "10"],
    depositAmounts: [25, 50], // min: 25 ethers, max: 50 ethers
    adminFeeRate: 45, // 4.5%
    originationFeeRate: 45, // 4.5%
    fixedInterestRate: FixedPoint.normalizeRate("0.02"),
    tickThreshold: FixedPoint.from("0.05"),
    tickExponential: FixedPoint.from("2.0"),
  };

  // test suite internal storage
  let deposits: Map<string, Map<string, [ethers.BigNumber, ethers.BigNumber, SignerWithAddress, boolean]>>; // address -> (depth -> [amount, shares, depositor, redemptionPending])
  let loans: [SignerWithAddress, ethers.BigNumber, string][]; // list of (borrower address, token id, encoded loan receipt)
  let depths: Set<string>; // set of depths
  let collateralsOwned: Map<string, Set<ethers.BigNumber>>; // address -> list of token ids - removed when used as collateral
  let collateralTokenId: ethers.BigNumber = ethers.constants.Zero; // token id counter

  let callSequence: any[];

  before("deploy fixture", async () => {
    accounts = await ethers.getSigners();

    const testERC20Factory = await ethers.getContractFactory("TestERC20");
    const testERC721Factory = await ethers.getContractFactory("TestERC721");
    const testProxyFactory = await ethers.getContractFactory("TestProxy");
    const collectionCollateralFilterFactory = await ethers.getContractFactory("CollectionCollateralFilter");
    const testLoanReceiptFactory = await ethers.getContractFactory("TestLoanReceipt");
    const fixedInterestRateModelFactory = await ethers.getContractFactory("FixedInterestRateModel");
    const externalCollateralLiquidatorFactory = await ethers.getContractFactory("ExternalCollateralLiquidator");
    const delegationRegistryFactory = await ethers.getContractFactory("TestDelegationRegistry");

    /* Deploy test currency token */
    tok1 = (await testERC20Factory.deploy(
      "Token 1",
      "TOK1",
      18,
      ethers.utils.parseEther("1000000000000")
    )) as TestERC20;
    await tok1.deployed();

    /* Deploy test NFT */
    nft1 = (await testERC721Factory.deploy("NFT 1", "NFT1", "https://nft1.com/token/")) as TestERC721;
    await nft1.deployed();

    /* Deploy loan receipt library */
    loanReceiptLib = await testLoanReceiptFactory.deploy();
    await loanReceiptLib.deployed();

    /* Deploy collateral filter implementation */
    collateralFilterImpl = await collectionCollateralFilterFactory.deploy();
    await collateralFilterImpl.deployed();

    /* Deploy interest rate model implementation */
    interestRateModelImpl = await fixedInterestRateModelFactory.deploy();
    await interestRateModelImpl.deployed();

    /* Deploy external collateral liquidator implementation */
    collateralLiquidatorImpl = await externalCollateralLiquidatorFactory.deploy();
    await collateralLiquidatorImpl.deployed();

    /* Deploy test delegation registry */
    delegationRegistry = await delegationRegistryFactory.deploy();
    await delegationRegistry.deployed();

    /* Deploy pool implementation */
    const poolFactory = await ethers.getContractFactory("Pool");
    poolImpl = await poolFactory.deploy();
    await poolImpl.deployed();

    /* Deploy pool */
    const proxy = await testProxyFactory.deploy(
      poolImpl.address,
      poolImpl.interface.encodeFunctionData("initialize", [
        accounts[0].address,
        nft1.address,
        tok1.address,
        30 * 86400,
        CONFIG.originationFeeRate,
        delegationRegistry.address,
        collateralFilterImpl.address,
        interestRateModelImpl.address,
        collateralLiquidatorImpl.address,
        ethers.utils.defaultAbiCoder.encode(["address"], [nft1.address]),
        ethers.utils.defaultAbiCoder.encode(
          ["uint64", "uint64", "uint64"],
          [CONFIG.fixedInterestRate, CONFIG.tickThreshold, CONFIG.tickExponential]
        ),
        ethers.utils.defaultAbiCoder.encode(["address"], [accounts[19].address]),
      ])
    );
    await proxy.deployed();
    pool = (await ethers.getContractAt("Pool", proxy.address)) as Pool;

    // set admin rate at 4.5%
    await pool.setAdminFeeRate(CONFIG.adminFeeRate);

    /* Attach collateral liquidator */
    collateralLiquidator = (await ethers.getContractAt(
      "ExternalCollateralLiquidator",
      await pool.collateralLiquidator()
    )) as ExternalCollateralLiquidator;

    /* Arrange accounts */
    accountDepositors = accounts.slice(0, 10);
    accountBorrowers = accounts.slice(10, 19);
    accountLender = accounts[19];

    /* Transfer TOK1 to depositors and approve Pool */
    for (const depositor of accountDepositors) {
      await tok1.transfer(depositor.address, ethers.utils.parseEther("100000000"));
      await tok1.connect(depositor).approve(pool.address, ethers.constants.MaxUint256);
    }

    /* Transfer TOK1 to borrowers and approve Pool */
    for (const borrower of accountBorrowers) {
      await tok1.transfer(borrower.address, ethers.utils.parseEther("100000000"));
      await tok1.connect(borrower).approve(pool.address, ethers.constants.MaxUint256);
      await nft1.connect(borrower).setApprovalForAll(pool.address, true);
    }

    // instantiate Pool Model class
    poolModel = new PoolModel(
      ethers.BigNumber.from(CONFIG.adminFeeRate),
      ethers.BigNumber.from(CONFIG.originationFeeRate),
      "fixed",
      [CONFIG.fixedInterestRate, CONFIG.tickThreshold, CONFIG.tickExponential]
    );

    // create call sequence
    callSequence = await generateCallSequence();
  });

  beforeEach("snapshot blockchain", async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);

    // reset internal storage
    depths = new Set<ethers.BigNumber>(); // set of depths
    collateralsOwned = new Map<string, Set<ethers.BigNumber>>();
    loans = [];
    deposits = new Map<string, Map<string, [ethers.BigNumber, ethers.BigNumber, SignerWithAddress, boolean]>>();
    collateralTokenId = ethers.constants.Zero;
  });

  afterEach("restore blockchain snapshot", async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  /****************************************************************************/
  /* Helper functions */
  /****************************************************************************/

  function getRandomInteger(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min)) + min;
  }

  function getRandomBN(max: ethers.BigNumber): ethers.BigNumber {
    return ethers.BigNumber.from(ethers.utils.randomBytes(32)).mod(max);
  }

  function removeLoanFromLoans(encodedLoanReceipt: string) {
    const indexOfRepaidLoan: number = loans.findIndex(
      (l: [SignerWithAddress, ethers.BigNumber, string]) => l[2] === encodedLoanReceipt
    );
    if (indexOfRepaidLoan === -1) {
      throw new Error("Loan should be in loans");
    }
    loans.splice(indexOfRepaidLoan, 1); // remove this loan
  }

  function flattenDeposits(
    hasRedemptionPending: boolean
  ): [ethers.BigNumber, ethers.BigNumber, ethers.BigNumber, SignerWithAddress][] {
    const flattenedDeposits: [ethers.BigNumber, ethers.BigNumber, ethers.BigNumber, SignerWithAddress][] = [];
    deposits.forEach(
      async (
        depths: Map<string, [ethers.BigNumber, ethers.BigNumber, SignerWithAddress, boolean]>,
        address: string
      ) => {
        depths.forEach(
          async (value: [ethers.BigNumber, ethers.BigNumber, SignerWithAddress, boolean], depth: string) => {
            if (value[3] === hasRedemptionPending) {
              // exclude redemptionPending deposits
              flattenedDeposits.push([depth, value[0], value[1], value[2]]); // depth, amount, shares, depositor
            }
          }
        );
      }
    );
    return flattenedDeposits;
  }

  async function sourceLiquidity(amount: ethers.BigNumber, itemCount: ethers.BigNumber): Promise<ethers.BigNumber[]> {
    const nodes = await pool.liquidityNodes(0, ethers.constants.MaxUint256);
    const depths = [];

    const minBN = (a: ethers.BigNumber, b: ethers.BigNumber) => (a.lt(b) ? a : b);
    const maxBN = (a: ethers.BigNumber, b: ethers.BigNumber) => (a.gt(b) ? a : b);

    let taken = ethers.constants.Zero;
    let prevDepth = ethers.constants.Zero;
    let carry = ethers.constants.Zero;
    for (const node of nodes) {
      const depthAmount = node.depth.sub(prevDepth).mul(itemCount).add(carry);
      const take = minBN(minBN(depthAmount, node.available), amount.sub(taken));
      carry = node.available.lt(depthAmount) ? depthAmount.sub(node.available) : ethers.constants.Zero;
      prevDepth = node.depth;
      if (take.isZero()) continue;
      depths.push(node.depth);
      taken = taken.add(take);
    }

    if (!taken.eq(amount)) throw new Error(`Insufficient liquidity for amount ${amount.toString()}`);

    return depths;
  }

  async function compareStates(): Promise<void> {
    console.log("Comparing states...");
    // compare all states
    // compare admin fee balance
    expect(await pool.adminFeeBalance()).to.equal(poolModel.adminFeeBalance, "Admin fee balance unequal");

    // compare pool's token balance
    expect(await tok1.balanceOf(pool.address)).to.equal(poolModel.tokenBalances, "Token balance unequal");

    // compare pool's collateral balance
    expect(await nft1.balanceOf(pool.address)).to.equal(poolModel.collateralBalances, "Collateral balance unequal");

    // compare liquidity nodes
    if (depths.size > 0) {
      let sortedDepths: string[] = Array.from(depths);

      sortedDepths.sort(function (a, b) {
        return a.localeCompare(b, undefined, { numeric: true });
      });

      let sortedDepthsBN: ethers.BigNumber[] = sortedDepths.map((d) => {
        return ethers.BigNumber.from(d);
      });

      const liquidityNodes = await pool.liquidityNodes(sortedDepthsBN[0], sortedDepthsBN[sortedDepthsBN.length - 1]);
      const expectedLiquidityNodes = poolModel.liquidityNodes(sortedDepthsBN);

      // compare here
      expect(liquidityNodes.length).to.equal(expectedLiquidityNodes.length, "Liquidity nodes unequal");
      for (let i = 0; i < liquidityNodes.length; i++) {
        const node = liquidityNodes[i];
        const expectedNode = expectedLiquidityNodes[i];
        expect(node.depth).to.equal(expectedNode.depth, "Node depth unequal");
        expect(node.value).to.equal(expectedNode.value, "Node depth value");
        expect(node.shares).to.equal(expectedNode.shares, "Node depth shares");
        expect(node.available).to.equal(expectedNode.available, "Node depth available");
        expect(node.pending).to.equal(expectedNode.pending, "Node depth pending");
        expect(node.redemptions).to.equal(expectedNode.redemptions, "Node depth redemptions");
      }
    }

    // compare deposits
    deposits.forEach(
      async (
        depths: Map<string, [ethers.BigNumber, ethers.BigNumber, SignerWithAddress, boolean]>,
        address: string
      ) => {
        depths.forEach(
          async (value: [ethers.BigNumber, ethers.BigNumber, SignerWithAddress, boolean], depth: string) => {
            const expectedDeposit = await poolModel.deposits.get(address)?.get(depth);
            if (expectedDeposit === undefined) {
              throw new Error("expectedDeposit should exist");
            }
            const deposit = await pool.deposits(address, depth);
            expect(deposit.shares).to.equal(expectedDeposit.shares, "Deposit shares unequal");
            expect(deposit.redemptionIndex).to.equal(
              expectedDeposit.redemptionIndex,
              "Deposit redemption index unequal"
            );
            expect(deposit.redemptionPending).to.equal(
              expectedDeposit.redemptionPending,
              "Deposit redemption pending unequal"
            );
            expect(deposit.redemptionTarget).to.equal(
              expectedDeposit.redemptionTarget,
              "Deposit redemption target unequal"
            );
          }
        );
      }
    );
  }

  async function getTransactionTimestamp(blockNumber: ethers.BigNumber): Promise<ethers.BigNumber> {
    const block = await ethers.provider.getBlock(blockNumber);
    return block.timestamp;
  }

  async function generateCallSequence(): Promise<any[]> {
    const callSequence = [];
    for (let i = 0; i < CONFIG.maxFunctionCalls; i++) {
      const functionCallIndex = getRandomInteger(0, CONFIG.functionCalls.length);
      const functionCall = CONFIG.functionCalls[functionCallIndex];

      callSequence.push(functionCall);
    }
    return callSequence;
  }

  /****************************************************************************/
  /* Function Wrappers */
  /****************************************************************************/

  async function deposit(): Promise<void> {
    try {
      console.log("Executing deposit()...");

      const depositor = accountDepositors[getRandomInteger(0, accountDepositors.length)];
      const depth = ethers.utils.parseEther(CONFIG.depths[getRandomInteger(0, CONFIG.depths.length)]);
      const amount = ethers.utils.parseEther(
        getRandomInteger(CONFIG.depositAmounts[0], CONFIG.depositAmounts[CONFIG.depositAmounts.length - 1]).toString()
      );

      // Execute deposit() on Pool
      const depositTx = await pool.connect(depositor).deposit(depth, amount);

      // Execute deposit() on PoolModel
      poolModel.deposit(depositor.address, depth, amount);

      // Get shares
      const shares = (await extractEvent(depositTx, pool, "Deposited")).args.shares;

      // Update our helper variables
      const depositorsDeposits =
        deposits.get(depositor.address) ??
        new Map<string, [ethers.BigNumber, ethers.BigNumber, SignerWithAddress, boolean]>();
      const depthDeposit = depositorsDeposits.get(depth.toString()) ?? [
        ethers.constants.Zero,
        ethers.constants.Zero,
        depositor,
        false,
      ];
      const newDepthDeposit: [ethers.BigNumber, ethers.BigNumber, SignerWithAddress, boolean] = [
        depthDeposit[0].add(amount),
        depthDeposit[1].add(shares),
        depositor,
        depthDeposit[3],
      ];
      depositorsDeposits.set(depth.toString(), newDepthDeposit);
      deposits.set(depositor.address, depositorsDeposits);
      depths.add(depth.toString());

      console.log(`${depositor.address}: Deposited ${amount} at depth ${depth}`);
    } catch (e) {
      console.log("deposit() failed:", e);
    }
  }

  async function borrow(): Promise<void> {
    try {
      console.log("Executing borrow()...");

      const borrower = accountBorrowers[getRandomInteger(0, accountBorrowers.length)];

      const duration = ethers.BigNumber.from(
        getRandomInteger(CONFIG.durations[0], CONFIG.durations[CONFIG.durations.length - 1])
      );

      const principal = ethers.utils.parseEther(
        getRandomInteger(CONFIG.principals[0], CONFIG.principals[CONFIG.principals.length - 1]).toString()
      );

      // Check if liquidity available
      let maxDepth = ethers.constants.Zero;
      for (const depth of depths.values()) {
        const d = ethers.BigNumber.from(depth);
        maxDepth = d.gt(maxDepth) ? d : maxDepth;
      }
      const liquidity = await pool.liquidityAvailable(maxDepth);
      if (liquidity.lt(principal)) {
        console.log("Insufficient liquidity");
        return;
      }

      // source liquidity
      const _depths = await sourceLiquidity(principal, 1);

      // Get max repayment
      const maxRepayment = principal.mul(2);

      let tokenId;

      // check if borrower has existing collaterals
      const borrowerCollaterals = collateralsOwned.get(borrower.address);
      if (borrowerCollaterals === undefined || borrowerCollaterals.size === 0) {
        tokenId = collateralTokenId;
        // mint before borrowing
        await nft1.mint(borrower.address, tokenId);

        // increase collateralTokenId counter since we just minted one
        collateralTokenId = collateralTokenId.add(1);
      } else {
        const _borrowerCollaterals = Array.from(borrowerCollaterals);
        tokenId = _borrowerCollaterals[Math.floor(Math.random() * _borrowerCollaterals.length)];

        // remove token id from borrower's collaterals
        borrowerCollaterals.delete(tokenId);
        collateralsOwned.set(borrower.address, borrowerCollaterals);
      }

      // Execute borrow() on Pool
      const borrowTx = await pool.connect(borrower).borrow(principal, duration, [tokenId], maxRepayment, _depths, "0x");

      // get block timestamp of borrow transaction
      const blockTimestamp = ethers.BigNumber.from(await getTransactionTimestamp(borrowTx.blockNumber));

      // Get encoded loan receipt
      const encodedLoanReceipt: string = (await extractEvent(borrowTx, pool, "LoanOriginated")).args.loanReceipt;

      // Execute borrow() on PoolModel
      poolModel.borrow(
        borrower.address,
        blockTimestamp,
        encodedLoanReceipt,
        principal,
        duration,
        [tokenId],
        maxRepayment,
        _depths
      );

      // Store encode loan receipt and borrower's loan count
      loans.push([borrower, tokenId, encodedLoanReceipt]);

      console.log(`${borrower.address}: Borrowed ${principal} for ${duration} seconds`);
    } catch (e) {
      console.log("borrow() failed:", e);
    }
  }

  async function repay(): Promise<void> {
    try {
      console.log("Executing repay()...");

      // Skip repay() if there are no existing loans
      if (loans.length === 0) {
        console.log("No existing loans exists");
        return;
      }

      // Randomly select existing loans
      const loan = loans[getRandomInteger(0, loans.length)];

      const [borrower, tokenId, encodedLoanReceipt] = loan;

      // Get previous block timestamp
      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      const timestamp = ethers.BigNumber.from(block.timestamp);

      // Decode loan receipt to get maturity
      const decodedLoanReceipt = await loanReceiptLib.decode(encodedLoanReceipt);
      const maturity = decodedLoanReceipt.maturity;

      // Check if expired
      if (timestamp.gt(maturity)) {
        // Remove loan from internal records based on encoded loan receipt
        removeLoanFromLoans(encodedLoanReceipt);
        return;
      }

      // Go fast forward to a random timestamp that is before maturity
      const randomTimestamp = getRandomBN(maturity.sub(timestamp)).add(timestamp);
      elapseUntilTimestamp(randomTimestamp);

      // Execute repay() on Pool
      const repayTx = await pool.connect(borrower).repay(encodedLoanReceipt);

      // get block timestamp of borrow transaction
      const blockTimestamp = ethers.BigNumber.from(await getTransactionTimestamp(repayTx.blockNumber));

      // Execute repay() on PoolModel
      poolModel.repay(borrower.address, blockTimestamp, encodedLoanReceipt);
      // Remove loan from internal records based on encoded loan receipt
      removeLoanFromLoans(encodedLoanReceipt);

      // Indicate that borrower now has the collateral
      const borrowerCollaterals: Set<ethers.BigNumber> = collateralsOwned.get(borrower.address) ?? new Set();
      borrowerCollaterals.add(tokenId);
      collateralsOwned.set(borrower.address, borrowerCollaterals);

      console.log(
        `${borrower.address}: Repaid loan ${encodedLoanReceipt.slice(0, 10)}...${encodedLoanReceipt.slice(
          encodedLoanReceipt.length - 10,
          encodedLoanReceipt.length
        )}`
      );
    } catch (e) {
      console.log("repay() failed:", e);
    }
  }

  async function refinance(): Promise<void> {
    try {
      console.log("Executing refinance()...");

      const duration = ethers.BigNumber.from(
        getRandomInteger(CONFIG.durations[0], CONFIG.durations[CONFIG.durations.length - 1])
      );
      const principal = ethers.utils.parseEther(
        getRandomInteger(CONFIG.principals[0], CONFIG.principals[CONFIG.principals.length - 1]).toString()
      );

      // Skip refinance() if there are no existing loans
      if (loans.length === 0) {
        console.log("No existing loans exists");
        return;
      }

      // Randomly select existing loans
      const loan = loans[getRandomInteger(0, loans.length)];

      const [borrower, tokenId, encodedLoanReceipt] = loan;

      // Get previous block timestamp
      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      const timestamp = ethers.BigNumber.from(block.timestamp);

      // Decode loan receipt to get maturity
      const decodedLoanReceipt = await loanReceiptLib.decode(encodedLoanReceipt);
      const maturity = decodedLoanReceipt.maturity;

      // Check if expired
      if (timestamp.gt(maturity)) {
        // Remove loan from internal records based on encoded loan receipt
        removeLoanFromLoans(encodedLoanReceipt);
        return;
      }

      const collateralTokenId = decodedLoanReceipt.collateralTokenId;

      // Go fast forward to a random timestamp that is before maturity
      const randomTimestamp = getRandomBN(maturity.sub(timestamp)).add(timestamp);
      elapseUntilTimestamp(randomTimestamp);

      // Check if liquidity available
      let maxDepth = ethers.constants.Zero;
      for (const depth of depths.values()) {
        const d = ethers.BigNumber.from(depth);
        maxDepth = d.gt(maxDepth) ? d : maxDepth;
      }

      const liquidity = await pool.liquidityAvailable(maxDepth);
      if (liquidity.lt(principal)) {
        console.log("Insufficient liquidity");
        return;
      }

      // source liquidity
      const _depths = await sourceLiquidity(principal, 1);

      // Get max repayment
      const maxRepayment = principal.mul(2);

      // Execute repay() on Pool
      const refinanceTx = await pool
        .connect(borrower)
        .refinance(encodedLoanReceipt, principal, duration, maxRepayment, _depths);

      // get block timestamp of borrow transaction
      const blockTimestamp = ethers.BigNumber.from(await getTransactionTimestamp(refinanceTx.blockNumber));

      // Get new encoded loan receipt
      const newEncodedLoanReceipt: string = (await extractEvent(refinanceTx, pool, "LoanOriginated")).args.loanReceipt;

      // Execute refinance() on PoolModel
      poolModel.refinance(
        borrower.address,
        blockTimestamp,
        [collateralTokenId],
        encodedLoanReceipt,
        newEncodedLoanReceipt,
        principal,
        duration,
        maxRepayment,
        _depths
      );

      // Remove loan from internal records based on encoded loan receipt
      removeLoanFromLoans(encodedLoanReceipt);

      // Store new encode loan receipt and borrower's loan count
      loans.push([borrower, tokenId, newEncodedLoanReceipt]);

      console.log(
        `${borrower.address}: Refinanced loan ${encodedLoanReceipt.slice(0, 10)}...${encodedLoanReceipt.slice(
          encodedLoanReceipt.length - 10,
          encodedLoanReceipt.length
        )}`
      );
    } catch (e) {
      console.log("refinance() failed:", e);
    }
  }

  async function redeem(): Promise<void> {
    try {
      console.log("Executing redeem()...");

      // Randomly select existing deposit that has redemption pending = false
      const flattenedDeposits = flattenDeposits(false);
      if (flattenedDeposits.length === 0) {
        console.log("No deposits with no redemption pending");
        return;
      }
      const [depth, amount, shares, depositor] = flattenedDeposits[getRandomInteger(0, flattenedDeposits.length)];
      const randomSharesAmount = getRandomBN(shares);

      // Execute redeem() on Pool
      await pool.connect(depositor).redeem(depth, randomSharesAmount);

      // Execute redeem() on PoolModel
      poolModel.redeem(depositor.address, depth, randomSharesAmount);

      // Update our helper variables
      const depositorsDeposits = deposits.get(depositor.address);

      if (depositorsDeposits === undefined) {
        throw new Error("depositorDeposits should exists");
      }

      // set redemption pending to true
      const newDepthDeposit: [ethers.BigNumber, ethers.BigNumber, SignerWithAddress, boolean] = [
        amount,
        shares,
        depositor,
        true,
      ];
      depositorsDeposits.set(depth.toString(), newDepthDeposit);
      deposits.set(depositor.address, depositorsDeposits);

      console.log(`${depositor.address}: Redeemed ${shares} shares at depth ${depth}`);
    } catch (e) {
      console.log("repay() failed:", e);
    }
  }

  async function withdraw(): Promise<void> {
    try {
      console.log("Executing withdraw()...");

      // Randomly select existing deposit that has redemption pending = true
      const flattenedDeposits = flattenDeposits(true);
      if (flattenedDeposits.length === 0) {
        console.log("No deposits with pending redemption");
        return;
      }

      const [depth, amount, shares, depositor] = flattenedDeposits[getRandomInteger(0, flattenedDeposits.length)];

      // Execute withdraw() on Pool
      const withdrawTx = await pool.connect(depositor).withdraw(depth);

      // Execute withdraw() on PoolModel
      poolModel.withdraw(depositor.address, depth);

      // Get shares
      const _shares = (await extractEvent(withdrawTx, pool, "Withdrawn")).args.shares;

      // Get amount
      const _amount = (await extractEvent(withdrawTx, pool, "Withdrawn")).args.amount;

      // Update our helper variables
      const depositorsDeposits = deposits.get(depositor.address);

      if (depositorsDeposits === undefined) {
        throw new Error("depositorDeposits should exists");
      }

      const newAmount = amount.sub(_amount);
      const newRedemptionPending = shares.sub(_shares);

      // Update depositor's deposit record
      const newDepthDeposit: [ethers.BigNumber, ethers.BigNumber, SignerWithAddress, boolean] = [
        newAmount,
        newRedemptionPending,
        depositor,
        false, // if redemptionPending === 0, then false
      ];
      depositorsDeposits.set(depth.toString(), newDepthDeposit);
      deposits.set(depositor.address, depositorsDeposits);

      console.log(`${depositor.address}: Withdrew ${amount} tokens and ${shares} share at depth ${depth}`);
    } catch (e) {
      console.log("withdraw() failed:", e);
    }
  }

  describe("#test", async function () {
    it("test", async function () {
      for (let i = 0; i < callSequence.length; i++) {
        console.log("\n--------------\n");
        const functionCall = callSequence[i];
        await functionCall();
        await compareStates();
      }
      console.log("Call sequence complete!");
    });
  });
});
