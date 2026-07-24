import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const fixtureRoot = join(process.cwd(), "tests/.tmp-package-tree");
const ownerDirectoryMode = Number("448");
const unreadableDirectoryMode = Number("0");

afterEach(async () => {
  await chmod(join(fixtureRoot, "service-data"), ownerDirectoryMode).catch(
    () => undefined,
  );
  await rm(fixtureRoot, { force: true, recursive: true });
});

describe("verify-tree", () => {
  test("skips generated shards and unreadable service data", async () => {
    const generatedShardRoot = join(fixtureRoot, ".test-shards/shard-0");
    const packageRoot = join(fixtureRoot, "package");
    const unreadableRoot = join(fixtureRoot, "service-data");
    await mkdir(generatedShardRoot, { recursive: true });
    await mkdir(packageRoot, { recursive: true });
    await mkdir(unreadableRoot, { recursive: true });
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "fixture" }),
    );
    await writeFile(
      join(generatedShardRoot, "package.json"),
      JSON.stringify({
        name: "generated-copy",
        peerDependencies: { react: ">=19" },
      }),
    );
    await chmod(unreadableRoot, unreadableDirectoryMode);

    const child = Bun.spawn(
      [
        process.execPath,
        join(process.cwd(), "src/cli.ts"),
        "verify-tree",
        fixtureRoot,
      ],
      { stderr: "pipe", stdout: "pipe" },
    );
    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 package policies valid");

    if (process.getuid?.() === unreadableDirectoryMode) return;
    expect(stderr).toContain("skipped unreadable directory");
    expect(stderr).toContain(unreadableRoot);
  });
});
