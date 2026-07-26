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
    sepolia: {
      url: sepoliaRpcUrl,
      accounts: normalizedPrivateKey ? [normalizedPrivateKey] : [],
      chainId: 11155111,
    },
  },
};
