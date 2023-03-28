import { ethers } from "hardhat";
import { NodeSource } from "./LiquidityManagerModel";

export class FixedInterestRateModel {
  private FIXED_POINT_SCALE: ethers.BigNumber = ethers.utils.parseEther("1");

  private _fixedInterestRate: ethers.BigNumber;
  private _tickThreshold: ethers.BigNumber;
  private _tickExponential: ethers.BigNumber;

  constructor(fixedInterestRate: ethers.BigNumber, tickThreshold: ethers.BigNumber, tickExponential: ethers.BigNumber) {
    this._fixedInterestRate = fixedInterestRate;
    this._tickThreshold = tickThreshold;
    this._tickExponential = tickExponential;
  }

  public rate(): ethers.BigNumber {
    return this._fixedInterestRate;
  }

  public distribute(
    amount: ethers.BigNumber,
    interest: ethers.BigNumber,
    nodes: NodeSource[],
    count: number
  ): ethers.BigNumber[] {
    /* Interest threshold for tick to receive interest */
    const threshold = this._tickThreshold.mul(amount).div(this.FIXED_POINT_SCALE);

    /* Interest weight starting at final tick */
    const base = this._tickExponential;
    let weight = this.FIXED_POINT_SCALE.mul(this.FIXED_POINT_SCALE).div(base);

    /* Interest normalization */
    let normalization = ethers.constants.Zero;

    /* Assign weighted interest to ticks backwards */
    let pending = Array(count).fill(ethers.constants.Zero);

    for (let i = 0; i < count; i++) {
      let index = count - i - 1;

      /* Skip tick if it's below threshold */
      if (nodes[index].used.lt(threshold)) continue;

      /* Calculate contribution of this tick to total amount */
      let contribution = nodes[index].used.mul(this.FIXED_POINT_SCALE).div(amount);

      /* Calculate interest weight scaled by contribution */
      let scaledWeight = weight.mul(contribution).div(this.FIXED_POINT_SCALE);

      /* Calculate unnormalized interest to tick */
      pending[index] = scaledWeight.mul(interest).div(this.FIXED_POINT_SCALE);

      /* Accumulate scaled interest weight for later normalization */
      normalization = normalization.add(scaledWeight);

      /* Adjust interest weight for next tick */
      weight = weight.mul(this.FIXED_POINT_SCALE).div(base);
    }

    /* Normalize assigned interest */
    for (let i = 0; i < count; i++) {
      /* Calculate normalized interest to tick */
      pending[i] = pending[i].mul(this.FIXED_POINT_SCALE).div(normalization);

      /* Subtract from total interest */
      interest = interest.sub(pending[i]);
    }

    /* Drop off dust at lowest tick */
    pending[0] = pending[0].add(interest);

    return pending;
  }
}
