require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("dotenv").config({ quiet: true });

const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org";
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
const normalizedPrivateKey = deployerPrivateKey
  ? deployerPrivateKey.startsWith("0x")
    ? deployerPrivateKey
    : `0x${deployerPrivateKey}`
  : null;
const hasValidPrivateKey = /^0x[0-9a-fA-F]{64}$/.test(normalizedPrivateKey || "");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    localhost: {
      url: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      url: sepoliaRpcUrl,
      // Local compilation/tests must not fail when a deployment key is absent or redacted.
      // The deployment script reports an actionable error before a Sepolia deployment.
      accounts: hasValidPrivateKey ? [normalizedPrivateKey] : [],
      chainId: 11155111,
    },
  },
};
