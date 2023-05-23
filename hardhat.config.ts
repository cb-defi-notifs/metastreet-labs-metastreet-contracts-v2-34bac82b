import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-tracer";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.19",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
          outputSelection: { "*": { "*": ["storageLayout"] } },
        },
      },
    ],
  },
  networks: {
    ethereum: {
      url: process.env.ETHEREUM_URL || "",
      accounts: process.env.PRIVATE_KEY_LIQUIDATOR !== undefined ? [process.env.PRIVATE_KEY_LIQUIDATOR] : [],
    },
    goerli: {
      url: process.env.GOERLI_URL || "",
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    sepolia: {
      url: process.env.SEPOLIA_URL || "",
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
  },
  typechain: {
    outDir: "typechain",
  },
  mocha: {
    timeout: 100000000,
  },
};

export default config;
