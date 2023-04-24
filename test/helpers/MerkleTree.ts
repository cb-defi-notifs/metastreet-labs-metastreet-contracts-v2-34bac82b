import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

export class MerkleTree {
  static buildTree(values: any[][], encodings: string[]): StandardMerkleTree<any> {
    return StandardMerkleTree.of(values, encodings);
  }

  static buildProof(value: any, tree: StandardMerkleTree<any>): string {
    value = ethers.BigNumber.isBigNumber(value) ? value.toString() : value;
    for (const [i, v] of tree.entries()) {
      const v0 = ethers.BigNumber.isBigNumber(v[0]) ? v[0].toString() : v[0];
      if (v0 === value) {
        const proof = tree.getProof(i); /* in shape of bytes32[] */
        return ethers.utils.solidityPack(Array(proof.length).fill("bytes32"), proof);
      }
    }
    throw new Error("Input value is not part of tree");
  }

  static buildProofs(values: any[], tree: StandardMerkleTree<any>): string {
    values = values.map((v) => {
      return ethers.BigNumber.isBigNumber(v) ? v.toString() : v;
    });

    const proofs: string[][] = [];
    let maxLen = 0;
    for (const [index, value] of values.entries()) {
      for (const [i, v] of tree.entries()) {
        const v0 = ethers.BigNumber.isBigNumber(v[0]) ? v[0].toString() : v[0];
        if (v0 === value) {
          const proof = tree.getProof(i); /* in shape of bytes32[] */
          proofs.push(proof);
          maxLen = Math.max(maxLen, proof.length);
        }
      }
      if (index != proofs.length - 1) {
        throw new Error(`Input value ${value} is not part of tree`);
      }
    }

    const proofs_: string[] = [];

    for (let proof of proofs) {
      if (proof.length != maxLen) {
        if (maxLen - proof.length != 1) throw new Error("Invalid tree");
        proof.push(ethers.constants.HashZero);
      }
      proofs_.push(ethers.utils.solidityPack(Array(proof.length).fill("bytes32"), proof));
    }
    return ethers.utils.solidityPack(Array(proofs_.length).fill("bytes"), proofs_);
  }
}
