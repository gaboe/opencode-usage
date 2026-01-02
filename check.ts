type StepResult = {
  name: string;
  success: boolean;
  duration: number;
  output?: string;
};

type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function run(cmd: string[]): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { exitCode, stdout, stderr };
}

async function runStep(
  name: string,
  fn: () => Promise<{ success: boolean; output?: string }>
): Promise<StepResult> {
  const start = performance.now();
  const { success, output } = await fn();
  const duration = (performance.now() - start) / 1000;
  return { name, success, duration, output };
}

function formatDuration(seconds: number): string {
  return seconds >= 1
    ? `${seconds.toFixed(1)}s`
    : `${(seconds * 1000).toFixed(0)}ms`;
}

function printResult(result: StepResult): void {
  const icon = result.success ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`${icon} ${result.name} (${formatDuration(result.duration)})`);

  if (!result.success && result.output) {
    console.log();
    console.log(result.output);
  }
}

async function lint(): Promise<{ success: boolean; output?: string }> {
  const result = await run([
    "bunx",
    "oxlint",
    "-c",
    "./.oxlintrc.json",
    "--deny-warnings",
  ]);
  return {
    success: result.exitCode === 0,
    output: result.exitCode !== 0 ? result.stderr || result.stdout : undefined,
  };
}

async function typecheck(): Promise<{ success: boolean; output?: string }> {
  const result = await run(["bun", "tsc", "--noEmit"]);
  return {
    success: result.exitCode === 0,
    output: result.exitCode !== 0 ? result.stderr || result.stdout : undefined,
  };
}

async function format(): Promise<{ success: boolean; output?: string }> {
  const result = await run(["bunx", "oxfmt"]);
  return {
    success: result.exitCode === 0,
    output: result.exitCode !== 0 ? result.stderr || result.stdout : undefined,
  };
}

async function formatCheck(): Promise<{ success: boolean; output?: string }> {
  const result = await run(["bunx", "oxfmt", "--check"]);
  return {
    success: result.exitCode === 0,
    output: result.exitCode !== 0 ? result.stderr || result.stdout : undefined,
  };
}

type Command = "all" | "lint" | "typecheck" | "format" | "ci";

function parseArgs(): { command: Command } {
  const args = Bun.argv.slice(2);
  const command =
    (args.find((a: string) => !a.startsWith("-")) as Command) ?? "all";
  return { command };
}

async function runAll(): Promise<void> {
  // 1. Format first (may modify files)
  const formatResult = await runStep("format", format);
  printResult(formatResult);
  if (!formatResult.success) {
    process.exit(1);
  }

  // 2. Run lint and typecheck in parallel
  const [lintResult, typecheckResult] = await Promise.all([
    runStep("lint", lint),
    runStep("typecheck", typecheck),
  ]);

  printResult(lintResult);
  printResult(typecheckResult);

  if (!lintResult.success || !typecheckResult.success) {
    process.exit(1);
  }
}

async function runCi(): Promise<void> {
  // Run all checks in parallel (no format modification in CI)
  const [lintResult, typecheckResult, formatResult] = await Promise.all([
    runStep("lint", lint),
    runStep("typecheck", typecheck),
    runStep("format", formatCheck),
  ]);

  printResult(lintResult);
  printResult(typecheckResult);
  printResult(formatResult);

  if (
    !lintResult.success ||
    !typecheckResult.success ||
    !formatResult.success
  ) {
    process.exit(1);
  }
}

async function runSingle(command: Command): Promise<void> {
  let result: StepResult;

  switch (command) {
    case "lint":
      result = await runStep("lint", lint);
      break;
    case "typecheck":
      result = await runStep("typecheck", typecheck);
      break;
    case "format":
      result = await runStep("format", format);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log("Usage: bun check.ts [command]");
      console.log("Commands: all, lint, typecheck, format, ci");
      process.exit(1);
  }

  printResult(result);

  if (!result.success) {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { command } = parseArgs();

  switch (command) {
    case "all":
      await runAll();
      break;
    case "ci":
      await runCi();
      break;
    default:
      await runSingle(command);
  }
}

void main();
