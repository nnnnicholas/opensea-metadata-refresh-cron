// Fetches the 721 token count of a given contract via RPC
import { config } from "dotenv";
config();

import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const env = {
  NFT_ADDRESS: process.env.NFT_ADDRESS! as `0x${string}`,
  ALCHEMY_RPC_URL: process.env.ALCHEMY_RPC_URL!,
  OPENSEA_API_KEY: process.env.OPENSEA_API_KEY!,
  CRON_FREQUENCY: Number(process.env.CRON_FREQUENCY!),
  MAX_RUNTIME: Number(process.env.MAX_RUNTIME!),
  BUCKET_SIZE: Number(process.env.BUCKET_SIZE!),
  LEAK_RATE: Number(process.env.LEAK_RATE!),
  RETRY_LEAK_RATE: Number(process.env.RETRY_LEAK_RATE!),
  FIRST_TOKEN_ID: Number(process.env.FIRST_TOKEN_ID!),
  CONSECUTIVE_FAIL_LIMIT: Number(process.env.CONSECUTIVE_FAIL_LIMIT!),
  CONSECUTIVE_FAIL_RECOVERY_PERIOD: Number(
    process.env.CONSECUTIVE_FAIL_RECOVERY_PERIOD!
  ),
  HEALTHCHECKS_ACTIVE: process.env.HEALTHCHECKS_ACTIVE!,
  HEALTHCHECKS_URL: process.env.HEALTHCHECKS_URL!,
};

const ABI = [
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const; // const assertion
const client = createPublicClient({
  chain: mainnet,
  transport: http(env.ALCHEMY_RPC_URL ? env.ALCHEMY_RPC_URL : ""), // use Alchemy RPC if available
});

const result = client.readContract({
  abi: ABI,
  address: env.NFT_ADDRESS,
  functionName: "totalSupply",
});

export async function getTokenCount(): Promise<number> {
  const count = await result;
  // console.log(`Total supply of NFT: ${count}`);
  return Number(count);
}

// For local testing
getTokenCount().then((res) => console.log("Total supply of NFT:", res));
