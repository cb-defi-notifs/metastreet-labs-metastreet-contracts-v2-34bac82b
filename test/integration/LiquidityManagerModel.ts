import { ethers } from "hardhat";

export type FulfilledRedemption = {
  shares: ethers.BigNumber;
  amount: ethers.BigNumber;
};

export type NodeSource = {
  depth: ethers.BigNumber;
  available: ethers.BigNumber;
  used: ethers.BigNumber;
};

export type Redemptions = {
  pending: ethers.BigNumber;
  index: ethers.BigNumber;
  fulfilled: Map<string, FulfilledRedemption>;
};

export type Node = {
  depth: ethers.BigNumber;
  used: ethers.BigNumber;
  pending: ethers.BigNumber;
  available: ethers.BigNumber;
  shares: ethers.BigNumber;
  value: ethers.BigNumber;
  redemptions: Redemptions;
};

export type Liquidity = {
  total: ethers.BigNumber;
  used: ethers.BigNumber;
  numNodes: ethers.BigNumber;
  nodes: Map<string, Node>;
};

export type NodeInfo = {
  depth: ethers.BigNumber;
  value: ethers.BigNumber;
  shares: ethers.BigNumber;
  available: ethers.BigNumber;
  pending: ethers.BigNumber;
  redemptions: ethers.BigNumber;
};

export class LiquidityManagerModel {
  public FIXED_POINT_SCALE: ethers.BigNumber = ethers.utils.parseEther("1");

  public liquidityNodes(liquidity: Liquidity, depths: ethers.BigNumber[]): NodeInfo[] {
    let nodes: NodeInfo[] = [];
    let prevDepth = ethers.constants.Zero;

    for (let i = 0; i < depths.length; i++) {
      let depth = depths[i];

      if (prevDepth.gte(depth)) {
        throw new Error("liquidityNodes(): depth <= prevDepth");
      }

      let node = liquidity.nodes.get(depth.toString());

      if (node === undefined) {
        throw new Error("liquidityNodes(): node === undefined");
      }

      nodes.push({
        depth: depth,
        value: node.value,
        shares: node.shares,
        available: node.available,
        pending: node.pending,
        redemptions: node.redemptions.pending,
      });

      prevDepth = depth;
    }

    return nodes;
  }

  public liquidityAvailable(liquidity: Liquidity, depths: ethers.BigNumber[]): ethers.BigNumber {
    let amount = ethers.constants.Zero;

    for (let depth in depths) {
      const nodes = liquidity.nodes;

      // instantiate depth if does not exist
      let node = nodes.get(depth.toString());

      // node cannot be undefined
      if (node === undefined) {
        throw new Error("liquidityAvailable(): node === undefined");
      }

      amount = amount.add(node.available);
    }

    return amount;
  }

  public _isReserved(depth: ethers.BigNumber): boolean {
    return depth == 0 || depth == ethers.constants.MaxUint256;
  }

  public _isInsolvent(node: Node): boolean {
    return node.shares != 0 && node.value == 0;
  }

  // includes relevant logic from instantiate()
  public deposit(liquidity: Liquidity, depth: ethers.BigNumber, amount: ethers.BigNumber): ethers.BigNumber {
    const nodes = liquidity.nodes;

    // instantiate depth if does not exist
    let node = nodes.get(depth.toString()) ?? {
      depth,
      used: ethers.constants.Zero,
      pending: ethers.constants.Zero,
      available: ethers.constants.Zero,
      shares: ethers.constants.Zero,
      value: ethers.constants.Zero,
      redemptions: {
        pending: ethers.constants.Zero,
        index: ethers.constants.Zero,
        fulfilled: new Map<string, FulfilledRedemption>(),
      },
    };

    // calculate share price
    const price =
      node.shares == 0
        ? this.FIXED_POINT_SCALE
        : node.value
            .add(node.available.add(node.pending).sub(node.value).div(2))
            .mul(this.FIXED_POINT_SCALE)
            .div(node.shares);

    // calculate shares
    const shares = amount.mul(this.FIXED_POINT_SCALE).div(price);

    // update node for given depth
    node.value = node.value.add(amount);
    node.shares = node.shares.add(shares);
    node.available = node.available.add(amount);
    liquidity.numNodes = liquidity.numNodes.add(1);
    liquidity.nodes.set(depth.toString(), node);

    // update total liquidity
    liquidity.total = liquidity.total.add(amount);

    return shares;
  }

  public source(liquidity: Liquidity, amount: ethers.BigNumber, depths: ethers.BigNumber[]): [NodeSource[], number] {
    let sources: NodeSource[] = [];

    let prevDepth = ethers.constants.Zero;
    let taken = ethers.constants.Zero;

    for (let count = 0; count < depths.length && taken != amount; count++) {
      let depth = depths[count];

      if (prevDepth.gte(depth)) {
        throw new Error("source(): InvalidDepths()");
      }

      let node = liquidity.nodes.get(depth.toString());

      // node cannot be undefined
      if (node === undefined) {
        throw new Error("source(): node === undefined");
      }

      let innerTake = node.available.gt(depth.sub(taken)) ? depth.sub(taken) : node?.available;
      let take = amount.sub(taken).gt(innerTake) ? innerTake : amount.sub(taken);
      sources.push({
        depth,
        available: node.available - take,
        used: take,
      });
      taken = taken.add(take);
      prevDepth = depth;
    }

    if (amount.gt(taken)) {
      throw new Error("source(): InsufficientLiquidity()");
    }

    return [sources, sources.length];
  }

  public processRedemptions(liquidity: Liquidity, depth: ethers.BigNumber): [ethers.BigNumber, ethers.BigNumber] {
    const nodes = liquidity.nodes;

    // instantiate depth if does not exist
    let node = nodes.get(depth.toString());

    // node cannot be undefined
    if (node === undefined) {
      throw new Error("processRedemption(): node === undefined");
    }

    if (node.redemptions.pending == 0) {
      return [0, 0];
    }

    if (this._isInsolvent(node)) {
      let shares = node.redemptions.pending;

      // Record fullfiled redemption
      node.redemptions.fulfilled.set(node.redemptions.index, {
        shares: node.redemptions.pending,
        amount: 0,
      });

      /* Update node state */
      node.shares = node.shares.sub(shares);
      /* node.value and node.available already zero */
      node.redemptions.pending = node.redemptions.pending.sub(shares);
      node.redemptions.index = node.redemptions.index.add(1);

      return [shares, 0];
    } else {
      if (node.available == 0) return [0, 0];
      let price = node.value.mul(this.FIXED_POINT_SCALE).div(node.shares);
      let shares = node.redemptions.pending.gt(node.available.mul(this.FIXED_POINT_SCALE).div(price))
        ? node.available.mul(this.FIXED_POINT_SCALE).div(price)
        : node.redemptions.pending;
      let amount = shares.mul(price).div(this.FIXED_POINT_SCALE);
      node.redemptions.fulfilled.set(node.redemptions.index, { shares: shares, amount: amount });

      node.shares = node.shares.sub(shares);
      node.value = node.value.sub(amount);
      node.available = node.available.sub(amount);
      node.redemptions.pending = node.redemptions.pending.sub(shares);
      node.redemptions.index = node.redemptions.index.add(1);

      liquidity.total = liquidity.total.sub(amount);

      return [shares, amount];
    }
  }

  public restore(
    liquidity: Liquidity,
    depth: ethers.BigNumber,
    used: ethers.BigNumber,
    pending: ethers.BigNumber,
    restored: ethers.BigNumber
  ) {
    const nodes = liquidity.nodes;

    // instantiate depth if does not exist
    let node = nodes.get(depth.toString());

    // node cannot be undefined
    if (node === undefined) {
      throw new Error("restore(): node === undefined");
    }

    node.value = restored.gt(used) ? node.value.add(restored).sub(used) : node.value.sub(used).add(restored);
    node.available = node.available.add(restored);
    node.pending = node.pending.sub(pending);

    /* If node became insolvent */
    if (this._isInsolvent(node)) {
      /* Make node inactive by deleting it */
      liquidity.nodes.delete(depth);
      liquidity.numNodes--;
    }

    this.processRedemptions(liquidity, depth);
  }

  public redeem(
    liquidity: Liquidity,
    depth: ethers.BigNumber,
    shares: ethers.BigNumber
  ): [ethers.BigNumber, ethers.BigNumber] {
    const nodes = liquidity.nodes;

    // instantiate depth if does not exist
    let node = nodes.get(depth.toString()) ?? {
      depth,
      used: ethers.constants.Zero,
      pending: ethers.constants.Zero,
      available: ethers.constants.Zero,
      shares: ethers.constants.Zero,
      value: ethers.constants.Zero,
      redemptions: {
        pending: ethers.constants.Zero,
        index: ethers.constants.Zero,
        fulfilled: new Map<ethers.BigNumber, FulfilledRedemption>(),
      },
    };

    /* If depth is reserved */
    if (this._isReserved(depth)) {
      throw new Error("redeem(): InactiveLiquidity()");
    }

    /* Redemption from inactive liquidity nodes is allowed to facilitate
     * garbage collection of insolvent nodes */

    /* Snapshot redemption target */
    const redemptionIndex = node.redemptions.index;
    const redemptionTarget = node.redemptions.pending;

    /* Add shares to pending redemptions */
    node.redemptions.pending = node.redemptions.pending.add(shares);

    const fullfiled = node.redemptions.fulfilled.get(node.redemptions.index) ?? {
      shares: ethers.constants.Zero,
      amount: ethers.constants.Zero,
    };

    /* Initialize redemption record to save gas in loan callbacks */
    if (fullfiled.shares != ethers.constants.MaxUint256) {
      node.redemptions.fulfilled.set(node.redemptions.index, {
        shares: ethers.constants.MaxUint256,
        amount: 0,
      });
    }

    return [redemptionIndex, redemptionTarget];
  }

  public redemptionAvailable(
    liquidity: Liquidity,
    depth: ethers.BigNumber,
    pending: ethers.BigNumber,
    index: ethers.BigNumber,
    target: ethers.BigNumber
  ): [ethers.BigNumber, ethers.BigNumber] {
    const nodes = liquidity.nodes;

    // instantiate depth if does not exist
    let node = nodes.get(depth.toString());

    // node cannot be undefined
    if (node === undefined) {
      throw new Error("restore(): node === undefined");
    }

    let processedShares = ethers.constants.Zero;
    let totalRedeemedShares = ethers.constants.Zero;
    let totalRedeemedAmount = ethers.constants.Zero;

    for (; processedShares < target + pending; index.add(1)) {
      const redemption = node.redemptions.fulfilled.get(index);
      if (index == node.redemptions.index) {
        /* Reached pending redemption */
        break;
      }

      if (redemption === undefined) {
        throw new Error("redemptionAvailable(): redemption === undefined");
      }

      processedShares = processedShares.add(redemption.shares);
      if (processedShares < target) {
        continue;
      } else {
        const shares = (processedShares.gt(target.add(pending)) ? pending : processedShares.sub(target)).sub(
          totalRedeemedShares
        );
        const price = redemption.amount.mul(this.FIXED_POINT_SCALE).div(redemption.shares);

        totalRedeemedShares = totalRedeemedShares.add(shares);
        totalRedeemedAmount = totalRedeemedAmount.add(shares.mul(price).div(this.FIXED_POINT_SCALE));
      }
    }

    return [totalRedeemedShares, totalRedeemedAmount];
  }

  public use(liquidity: Liquidity, depth: ethers.BigNumber, used: ethers.BigNumber, pending: ethers.BigNumber) {
    const nodes = liquidity.nodes;

    // instantiate depth if does not exist
    let node = nodes.get(depth.toString());

    // node cannot be undefined
    if (node === undefined) {
      throw new Error("processRedemption(): node === undefined");
    }

    node.available = node.available.sub(used);
    node.pending = node.pending.add(pending);
  }
}
