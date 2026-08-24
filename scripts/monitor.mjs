import { spawn } from "node:child_process";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const DURATION_MS = 6 * 60 * 60 * 1000;
const INTERVAL_MS = 60 * 1000;
const PARALLEL_RUNS = Number(process.env.MONITOR_PARALLEL ?? 5);
const LOG_DIR = path.join(rootDir, "monitor-logs");
const LOG_FILE = path.join(LOG_DIR, "monitor.log");

function formatTime(date = new Date()) {
  return date.toISOString();
}

function log(message) {
  const line = `[${formatTime()}] ${message}`;
  console.log(line);
  return appendFile(LOG_FILE, `${line}\n`);
}

function runInstaTest(batch, slot) {
  const label = `[batch ${batch} #${slot}]`;

  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      ["exec", "playwright", "test", "-g", "insta", "--workers=1"],
      {
        cwd: rootDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      },
    );

    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      process.stdout.write(`${label} ${chunk}`);
    });

    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
      process.stderr.write(`${label} ${chunk}`);
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, output, slot });
    });
  });
}

async function runParallelBatch(batch) {
  const runs = Array.from({ length: PARALLEL_RUNS }, (_, index) =>
    runInstaTest(batch, index + 1),
  );
  return Promise.all(runs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await mkdir(LOG_DIR, { recursive: true });

  const startedAt = Date.now();
  const endsAt = startedAt + DURATION_MS;
  let batch = 0;
  let passed = 0;
  let failed = 0;

  await log(
    `Monitoring started for 6 hours (${DURATION_MS / 1000 / 60} minutes), interval ${INTERVAL_MS / 1000}s, ${PARALLEL_RUNS} parallel runs per batch`,
  );

  while (Date.now() < endsAt) {
    batch += 1;
    const batchStartedAt = Date.now();
    const remainingMs = endsAt - batchStartedAt;

    if (remainingMs <= 0) {
      break;
    }

    await log(`Batch ${batch} started (${PARALLEL_RUNS} parallel tests)`);

    const results = await runParallelBatch(batch);
    const durationMs = Date.now() - batchStartedAt;

    for (const result of results) {
      if (result.code === 0) {
        passed += 1;
      } else {
        failed += 1;
        await log(
          `Batch ${batch} #${result.slot} failed (exit code ${result.code})`,
        );
      }
    }

    const batchPassed = results.filter((result) => result.code === 0).length;
    await log(
      `Batch ${batch} finished in ${Math.round(durationMs / 1000)}s: ${batchPassed}/${PARALLEL_RUNS} passed`,
    );

    if (Date.now() >= endsAt) {
      break;
    }

    const waitMs = Math.max(0, INTERVAL_MS - durationMs);
    if (waitMs > 0) {
      await log(`Waiting ${Math.round(waitMs / 1000)}s until next batch`);
      await sleep(waitMs);
    } else {
      await log(
        `Batch ${batch} took longer than ${INTERVAL_MS / 1000}s; starting next batch immediately`,
      );
    }
  }

  const totalRuns = passed + failed;
  await log(
    `Monitoring finished. Batches: ${batch}, tests: ${totalRuns}, passed: ${passed}, failed: ${failed}`,
  );
}

main().catch(async (error) => {
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(LOG_FILE, `[${formatTime()}] Monitor crashed: ${error.stack ?? error}\n`);
  console.error(error);
  process.exit(1);
});
