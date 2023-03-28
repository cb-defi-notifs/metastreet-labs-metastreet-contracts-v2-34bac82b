import { ethers } from "hardhat";
import { LiquidityManagerModel, Liquidity, Node, NodeInfo } from "./LiquidityManagerModel";
import { FixedInterestRateModel } from "./FixedInterestRateModel";

type NodeReceipt = {
  depth: ethers.BigNumber;
  used: ethers.BigNumber;
  pending: ethers.BigNumber;
};

type LoanReceipt = {
  principal: ethers.BigNumber;
  repayment: ethers.BigNumber;
  borrower: string;
  maturity: ethers.BigNumber;
  duration: ethers.BigNumber;
  collateralToken: string;
  collateralTokenId: ethers.BigNumber;
  nodeReceipts: NodeReceipt[];
};

type Deposit = {
  shares: ethers.BigNumber;
  redemptionPending: ethers.BigNumber;
  redemptionIndex: ethers.BigNumber;
  redemptionTarget: ethers.BigNumber;
};

export class PoolModel {
  // hardcoded variables
  private BASIS_POINTS_SCALE = ethers.BigNumber.from(10000);
  private _liquidityManager = new LiquidityManagerModel();

  // states we are using for comparison
  public adminFeeBalance: ethers.BigNumber = ethers.constants.Zero;
  public liquidity: Liquidity = {
    total: ethers.constants.Zero,
    used: ethers.constants.Zero,
    numNodes: ethers.constants.Zero,
    nodes: new Map<ethers.BigNumber, Node>(),
  };
  public collateralBalances: ethers.BigNumber = ethers.constants.Zero;
  public tokenBalances: ethers.BigNumber = ethers.constants.Zero;
  public deposits: Map<string, Map<string, Deposit>> = new Map<string, Map<string, Deposit>>();

  // helper to keep track of loan receipts
  public loanReceipts: Map<string, Map<string, LoanReceipt>> = new Map<string, Map<string, LoanReceipt>>();

  // variables to be initialized
  public _adminFeeRate: ethers.BigNumber;
  public _originationFeeRate: ethers.BigNumber;
  private _interestRateModel;

  constructor(
    _adminFeeRate: ethers.BigNumber,
    _originationFeeRate: ethers.BigNumber,
    _interestRateModelType: string,
    _interestRateModelParams: any
  ) {
    this._adminFeeRate = _adminFeeRate;
    this._originationFeeRate = _originationFeeRate;

    // only accepting fixed interest rate for now
    this._interestRateModel =
      _interestRateModelType === "fixed"
        ? new FixedInterestRateModel(
            _interestRateModelParams[0],
            _interestRateModelParams[1],
            _interestRateModelParams[2]
          )
        : new FixedInterestRateModel(
            _interestRateModelParams[0],
            _interestRateModelParams[1],
            _interestRateModelParams[2]
          );
  }

  public liquidityNodes(depths: ethers.BigNumber[]): NodeInfo[] {
    return this._liquidityManager.liquidityNodes(this.liquidity, depths);
  }

  public _quote(principal: ethers.BigNumber, duration: ethers.BigNumber): ethers.BigNumber {
    /* Calculate repayment from principal, rate, and duration */
    return principal
      .mul(this._liquidityManager.FIXED_POINT_SCALE.add(this._interestRateModel.rate().mul(duration)))
      .div(this._liquidityManager.FIXED_POINT_SCALE)
      .add(principal.mul(this._originationFeeRate).div(this.BASIS_POINTS_SCALE));
  }

  public _prorateRepayment(
    blockTimestamp: ethers.BigNumber,
    loanReceipt: LoanReceipt
  ): [ethers.BigNumber, ethers.BigNumber] {
    const proration = blockTimestamp
      .sub(loanReceipt.maturity.sub(loanReceipt.duration))
      .mul(this._liquidityManager.FIXED_POINT_SCALE)
      .div(loanReceipt.duration);
    const originationFee = loanReceipt.principal.mul(this._originationFeeRate).div(this.BASIS_POINTS_SCALE);
    const repayment = loanReceipt.principal
      .add(originationFee)
      .add(
        loanReceipt.repayment
          .sub(originationFee)
          .sub(loanReceipt.principal)
          .mul(proration)
          .div(this._liquidityManager.FIXED_POINT_SCALE)
      );
    return [repayment, proration];
  }

  public deposit(address: string, depth: ethers.BigNumber, amount: ethers.BigNumber) {
    // update both node and liquidity (combines instantiate() and deposit())
    const shares = this._liquidityManager.deposit(this.liquidity, depth, amount);

    // update deposits
    let depositor = this.deposits.get(address) ?? new Map<string, Deposit>();
    let depthDeposit = depositor.get(depth.toString()) ?? {
      shares: ethers.constants.Zero,
      redemptionPending: ethers.constants.Zero,
      redemptionIndex: ethers.constants.Zero,
      redemptionTarget: ethers.constants.Zero,
    };
    depthDeposit.shares = depthDeposit.shares.add(shares);
    depositor.set(depth.toString(), depthDeposit);
    this.deposits.set(address, depositor);

    // process redemption
    this._liquidityManager.processRedemptions(this.liquidity, depth);
    // update token balance
    this.tokenBalances = this.tokenBalances.add(amount);
  }

  public borrow(
    address: string,
    blockTimestamp: ethers.BigNumber,
    encodedLoanReceipt: string,
    principal: ethers.BigNumber,
    duration: ethers.BigNumber,
    collateralTokenIds: ethers.BigNumber[],
    maxRepayment: ethers.BigNumber,
    depths: ethers.BigNumber[]
  ): ethers.BigNumber {
    const repayment = this._quote(principal, duration);

    /* Validate repayment */
    if (repayment.gt(maxRepayment)) {
      throw new Error("borrow(): RepaymentTooHigh()");
    }

    /* Source liquidity nodes */
    const [nodes, count] = this._liquidityManager.source(this.liquidity, principal, depths);

    /* Compute admin fee */
    const adminFee = this._adminFeeRate.mul(repayment.sub(principal)).div(this.BASIS_POINTS_SCALE);

    /* Distribute interest */
    const interest = this._interestRateModel.distribute(
      principal,
      repayment.sub(principal).sub(adminFee),
      nodes,
      count
    );

    /* Build the loan receipt */
    let receipt: LoanReceipt = {
      principal,
      repayment,
      borrower: address,
      maturity: blockTimestamp.add(duration),
      duration: duration,
      collateralToken: "",
      collateralTokenId: collateralTokenIds[0],
      nodeReceipts: [],
    };

    /* Use liquidity nodes */
    for (let i = 0; i < count; i++) {
      /* Use node */
      this._liquidityManager.use(this.liquidity, nodes[i].depth, nodes[i].used, nodes[i].used.add(interest[i]));

      /* Construct node receipt */
      receipt.nodeReceipts[i] = {
        depth: nodes[i].depth,
        used: nodes[i].used,
        pending: nodes[i].used.add(interest[i]),
      };
    }

    /* Update top level liquidity statistics */
    this.liquidity.used = this.liquidity.used.add(principal);

    /* Store loan receipt */
    let borrowerLoans = this.loanReceipts.get(address) ?? new Map<string, LoanReceipt>();
    borrowerLoans.set(encodedLoanReceipt, receipt);
    this.loanReceipts.set(address, borrowerLoans);

    // to be updated when we have bundles
    this.collateralBalances = this.collateralBalances.add(1);

    // send principal to borrower
    this.tokenBalances = this.tokenBalances.sub(principal);

    // returns repayment and loan index
    return repayment;
  }

  public repay(address: string, blockTimestamp: ethers.BigNumber, encodedLoanReceipt: string) {
    const loanReceipts = this.loanReceipts.get(address) ?? new Map<string, LoanReceipt>();

    const loanReceipt = loanReceipts.get(encodedLoanReceipt);

    if (loanReceipt === undefined) {
      throw new Error("repay(): loanReceipt === undefined");
    }

    const [repayment, proration] = this._prorateRepayment(blockTimestamp, loanReceipt);

    /* Restore liquidity nodes */
    let totalPending = ethers.constants.Zero;
    let totalUsed = ethers.constants.Zero;
    for (let i = 0; i < loanReceipt.nodeReceipts.length; i++) {
      /* Restore node */
      this._liquidityManager.restore(
        this.liquidity,
        loanReceipt.nodeReceipts[i].depth,
        loanReceipt.nodeReceipts[i].used,
        loanReceipt.nodeReceipts[i].pending,
        loanReceipt.nodeReceipts[i].used.add(
          loanReceipt.nodeReceipts[i].pending
            .sub(loanReceipt.nodeReceipts[i].used)
            .mul(proration)
            .div(this._liquidityManager.FIXED_POINT_SCALE)
        )
      );
      /* Track totals */
      totalPending = totalPending.add(loanReceipt.nodeReceipts[i].pending);
      totalUsed = totalUsed.add(loanReceipt.nodeReceipts[i].used);
    }

    /* Update top level liquidity statistics with prorated interest earned by pool */
    this.liquidity.total = this.liquidity.total.add(
      totalPending.sub(totalUsed).mul(proration).div(this._liquidityManager.FIXED_POINT_SCALE)
    );
    this.liquidity.used = this.liquidity.used.sub(totalUsed);

    /* Update admin fee total balance with prorated admin fee */
    this.adminFeeBalance = this.adminFeeBalance.add(
      loanReceipt.repayment.sub(totalPending).mul(proration).div(this._liquidityManager.FIXED_POINT_SCALE)
    );
    this.tokenBalances = this.tokenBalances.add(repayment);
    this.collateralBalances = this.collateralBalances.sub(1);
  }

  public redeem(address: string, depth: ethers.BigNumber, shares: ethers.BigNumber) {
    /* Look up Deposit */
    const deposits = this.deposits.get(address) ?? new Map<ethers.BigNumber, Deposit>();
    const dep = deposits.get(depth) ?? {
      shares: ethers.constants.Zero,
      redemptionPending: ethers.constants.Zero,
      redemptionIndex: ethers.constants.Zero,
      redemptionTarget: ethers.constants.Zero,
    };

    /* Validate shares */
    if (shares.gt(dep.shares)) {
      throw new Error("redeem(): InvalidShares()");
    }
    /* Validate redemption isn't pending */
    if (!dep.redemptionPending.eq(ethers.constants.Zero)) {
      throw new Error("redeem(): RedemptionInProgress()");
    }

    /* Redeem shares in tick with liquidity manager */
    const [redemptionIndex, redemptionTarget] = this._liquidityManager.redeem(this.liquidity, depth, shares);

    /* Update deposit state */
    dep.redemptionPending = shares;
    dep.redemptionIndex = redemptionIndex;
    dep.redemptionTarget = redemptionTarget;

    /* Process redemptions from available cash */
    this._liquidityManager.processRedemptions(this.liquidity, depth);
  }

  public withdraw(address: string, depth: ethers.BigNumber): ethers.BigNumber {
    /* Look up Deposit */
    const deposits = this.deposits.get(address) ?? new Map<string, Deposit>();
    const dep = deposits.get(depth) ?? {
      shares: ethers.constants.Zero,
      redemptionPending: ethers.constants.Zero,
      redemptionIndex: ethers.constants.Zero,
      redemptionTarget: ethers.constants.Zero,
    };

    /* If no redemption is pending */
    if (dep.redemptionPending == ethers.constants.Zero) return ethers.constants.Zero;

    /* Look up redemption available */
    const [shares, amount] = this._liquidityManager.redemptionAvailable(
      this.liquidity,
      depth,
      dep.redemptionPending,
      dep.redemptionIndex,
      dep.redemptionTarget
    );

    /* If the entire redemption is ready */
    if (shares == dep.redemptionPending) {
      dep.shares = dep.shares.sub(shares);
      dep.redemptionPending = ethers.constants.Zero;
      dep.redemptionIndex = ethers.constants.Zero;
      dep.redemptionTarget = ethers.constants.Zero;
    } else {
      dep.shares = dep.shares.sub(shares);
      dep.redemptionPending = dep.redemptionPending.sub(shares);
      dep.redemptionTarget = dep.redemptionTarget.add(shares);
    }

    /* Transfer Withdrawal Amount */
    this.tokenBalances = this.tokenBalances.sub(amount);

    return amount;
  }

  public refinance(
    address: string,
    blockTimestamp: ethers.BigNumber,
    collateralTokenIds: ethers.BigNumber[],
    encodedLoanReceipt: string,
    newEncodedLoanReceipt: string,
    principal: ethers.BigNumber,
    duration: ethers.BigNumber,
    maxRepayment: ethers.BigNumber,
    depths: ethers.BigNumber[]
  ): ethers.BigNumber {
    this.repay(address, blockTimestamp, encodedLoanReceipt);

    return this.borrow(
      address,
      blockTimestamp,
      newEncodedLoanReceipt,
      principal,
      duration,
      collateralTokenIds,
      maxRepayment,
      depths
    );
  }
}
