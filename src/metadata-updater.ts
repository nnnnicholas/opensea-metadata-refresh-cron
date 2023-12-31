//Metadata Updater

import fs from "fs";
import express from "express";
import { getTokenCount } from "./get721TokenCount.js";
import cron from "node-cron";
import { Request, Response } from "express";
import { config } from "dotenv";
config();

// Define your environment variables
// Disable non-null assertion temporarily. Non-null assertion is checked at runtime, but TSC doesn't know that.
/* eslint-disable @typescript-eslint/no-non-null-assertion */
const env = {
  NFT_ADDRESS: process.env.NFT_ADDRESS! as `0x${string}`,
  RPC_URL: process.env.RPC_URL!,
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
/* eslint-enable @typescript-eslint/no-non-null-assertion */

// Function to check if all environment variables are set
function checkEnvVariables(variables: {
  [key: string]: string | number | undefined;
}) {
  for (const key in variables) {
    if (variables[key] === undefined) {
      console.error(
        `Environment variable ${key} is not set. Please check your .env file or environment variables.`
      );
      process.exit(1);
    }
  }
}

// Call the function
checkEnvVariables(env);

const LAST_TOKEN_ID = (await getTokenCount()) as number;
const BASE_URL = "https://api.opensea.io/api/v1/asset";
const OPTIONS = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.102 Safari/537.36",
    "X-Api-Key": env.OPENSEA_API_KEY,
    referrer: BASE_URL,
  },
};

// Runtime global state
type FailedRequest = { tokenId: number; contractAddress: string };
const failedRequests: FailedRequest[] = [];
let isRunning = false;
let inRecovery = false;
let consecutiveFailures = 0;
let recoveryPeriodRemaining = 0;
let recoveryPeriods = 0; // Total recovery periods

// Function to simulate delay
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Function to update OpenSea metadata for all NFTs in the collection
async function fetchData(tokenId: number, contractAddress: string) {
  const url = `${BASE_URL}/${contractAddress}/${tokenId}/?force_update=true`;
  let requestSuccessful = false;

  try {
    const response = await fetch(url, OPTIONS);

    if (response.ok) {
      const data = await response.json();
      console.log(
        `Request for ${contractAddress} token ID ${tokenId} successful.`
      );
      // Mark the request as successful
      requestSuccessful = true;

      // Reset the consecutiveFailures counter when a request is successful
      consecutiveFailures = 0;

      // If recoveryPeriodRemaining is active, decrease it
      if (recoveryPeriodRemaining > 0) {
        recoveryPeriodRemaining--;
        if (recoveryPeriodRemaining === 0) {
          inRecovery = false; // End the recovery period when recoveryPeriodRemaining reaches 0
          console.log("Recovery period complete. Returning to full speed.");
        }
      }
    } else {
      console.error(
        `Error fetching data for token ID ${tokenId}:`,
        response.statusText
      );
      failedRequests.push({ tokenId, contractAddress }); // If a request fails, add it to the queue
    }
  } catch (error) {
    console.error(`Error fetching data for token ID ${tokenId}:`, error);
    failedRequests.push({ tokenId, contractAddress }); // If a request fails, add it to the queue
  } finally {
    // Increase the consecutiveFailures counter when a request fails
    if (!requestSuccessful) {
      consecutiveFailures++;

      // If there have been more than CONSECUTIVE_FAIL_LIMIT consecutive failures, start the recovery period
      if (consecutiveFailures > env.CONSECUTIVE_FAIL_LIMIT && !inRecovery) {
        recoveryPeriodRemaining = env.CONSECUTIVE_FAIL_RECOVERY_PERIOD;
        inRecovery = true; // Start the recovery period
        recoveryPeriods++; // Increase the count of recovery periods
        console.log(
          "Consecutive failure limit reached, starting recovery period."
        );
      }
    }
  }
}

// Loop through the token IDs make a GET request to opensea for each
async function fetchAllData() {
  if (isRunning) {
    return; // If the task is already running, return early.
  }
  isRunning = true;
  // Ping to indicate the job has started

  env.HEALTHCHECKS_ACTIVE
    ? await fetch(env.HEALTHCHECKS_URL + "/start", { method: "POST" })
    : null;

  const startTime = Date.now(); // Start time
  let requestCount = 0; // To count the number of requests
  let totalFetched = 0; // Total tokens fetched
  let operationStatus = "completed successfully";

  // Set a timeout to clear the failedRequests array and log an error message after env.MAX_RUNTIME minutes
  const timeout = setTimeout(() => {
    const currentTime = Date.now();
    const elapsedTime = (currentTime - startTime) / 1000; // Elapsed time in seconds
    failedRequests.length = 0;
    fs.appendFileSync(
      "cron.log",
      `Operation timed out after ${
        env.MAX_RUNTIME
      } minutes at ${new Date().toISOString()}.\nElapsed time: ${elapsedTime} seconds.\nTotal requests: ${requestCount}.\nTotal recovery periods: ${recoveryPeriods}.\nTotal 721 tokens fetched: ${totalFetched}.\n\n\n`
    );
    console.log(
      `Operation timed out after ${
        env.MAX_RUNTIME
      } minutes at ${new Date().toISOString()}. Elapsed time: ${elapsedTime} seconds. Total requests: ${requestCount}. Total recovery periods: ${recoveryPeriods}. Total 721 tokens fetched: ${totalFetched}..`
    );

    isRunning = false; // Remember to reset the lock after the task completes.
  }, env.MAX_RUNTIME * 60 * 1000); // minutes in milliseconds

  try {
    // Fetch 721 tokens
    for (
      let tokenId = env.FIRST_TOKEN_ID;
      tokenId <= LAST_TOKEN_ID;
      tokenId++
    ) {
      await fetchData(tokenId, env.NFT_ADDRESS);
      totalFetched++;
      requestCount++;

      // If we've hit the env.BUCKET_SIZE, we wait for the env.LEAK_RATE before continuing
      if (requestCount % env.BUCKET_SIZE === 0) {
        await delay(env.LEAK_RATE);
      }
    }

    while (failedRequests.length > 0) {
      const failedRequest = failedRequests.pop();

      if (failedRequest !== undefined) {
        const { tokenId, contractAddress } = failedRequest;
        console.log(`Retrying for token ID ${tokenId}`);
        await fetchData(tokenId, contractAddress);
        requestCount++;

        if (requestCount % env.BUCKET_SIZE === 0) {
          await delay(env.RETRY_LEAK_RATE);
        }
      }
    }

    clearTimeout(timeout);
    isRunning = false; // Reset the lock after the task completes.
    await fetch(env.HEALTHCHECKS_URL, { method: "POST" }); // Ping to indicate the job has completed
  } catch (error) {
    console.error(`Error during fetchAllData: ${error}`);
    operationStatus = `failed with error: ${error}`;
    // Ping to indicate the job has failed
    await fetch(env.HEALTHCHECKS_URL + "/fail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: `Error during fetchAllData: ${error}` }),
    });
  } finally {
    const endTime = Date.now(); // End time
    const elapsedTime = (endTime - startTime) / 1000; // Elapsed time in seconds
    // Write the log to a file named 'cron.log'
    fs.appendFileSync(
      "cron.log",
      `Operation ${operationStatus} at ${new Date().toISOString()}.\nElapsed time: ${elapsedTime} seconds.\nTotal requests: ${requestCount}.\nTotal recovery periods: ${recoveryPeriods}.\nTotal 721 tokens fetched: ${totalFetched}.\n\n\n`
    );
    console.log(
      `Operation ${operationStatus} at ${new Date().toISOString()}. Elapsed time: ${elapsedTime} seconds. Total requests: ${requestCount}. Total recovery periods: ${recoveryPeriods}. Total 721 tokens fetched: ${totalFetched}.`
    );
    clearTimeout(timeout);
    isRunning = false; // Remember to reset the lock after the task completes.
  }
}

// Define an Express app.
const app = express();

// Define a route that will trigger your fetchAllData function.
app.get("/refresh", (req: Request, res: Response) => {
  if (!isRunning) {
    fetchAllData().catch((error) => {
      console.error("Error during data refresh:", error);
      res.status(500).send("Error during data refresh.");
    });
    res.send("Refreshing data.");
  } else {
    res.send("Data refresh already in progress.");
  }
});

// Define the port to listen on.
const port = process.env.PORT || 3000;

// Start listening for requests.
app.listen(port, () => {
  console.log(`Server started at http://localhost:${port}`);
});

// Set a cron job to call the function every N minutes
cron.schedule(`*/${env.CRON_FREQUENCY} * * * *`, function () {
  if (!isRunning) {
    console.log("Running cron job");
    fetchAllData().catch((error) => {
      const errorMessage = `Error during cron job at ${new Date().toISOString()}: ${error}\n\n`;
      fs.appendFileSync("cron.log", errorMessage);
      console.error(errorMessage);
    });
  }
});

// Call the fetchAllData function
fetchAllData();
