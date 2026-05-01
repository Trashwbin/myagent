import { describe, it, expect, afterEach } from "vitest";
import { checkReadPolicy, isSensitiveReadPath } from "../src/permission/read-policy.js";
import { checkToolPermission } from "../src/permission/policy.js";
import { resolvePathInfo } from "../src/workspace/path-info.js";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";

// --- resolvePathInfo ---

describe("resolvePathInfo", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves workspace-relative path as inside workspace", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myagent-rp-"));
    await writeFile(join(tmpDir, "file.txt"), "content");

    const info = resolvePathInfo(tmpDir, "file.txt");
    expect(info).toBeDefined();
    expect(info!.insideWorkspace).toBe(true);
    expect(info!.realPath).toBe(realpathSync.native(join(tmpDir, "file.txt")));
  });

  it("resolves absolute path inside workspace", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myagent-rp-"));
    await writeFile(join(tmpDir, "file.txt"), "content");

    const info = resolvePathInfo(tmpDir, join(tmpDir, "file.txt"));
    expect(info!.insideWorkspace).toBe(true);
  });

  it("resolves sibling path as outside workspace", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myagent-rp-"));
    const sibling = `${tmpDir}-sibling`;
    await mkdir(sibling);
    await writeFile(join(sibling, "secret.txt"), "secret");

    const info = resolvePathInfo(tmpDir, `../${sibling.split("/").at(-1)}/secret.txt`);
    expect(info).toBeDefined();
    expect(info!.insideWorkspace).toBe(false);

    await rm(sibling, { recursive: true, force: true });
  });

  it("detects symlink pointing outside workspace", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myagent-rp-"));
    const outside = await mkdtemp(join(tmpdir(), "myagent-outside-"));
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(outside, join(tmpDir, "link"));

    const info = resolvePathInfo(tmpDir, "link/secret.txt");
    expect(info!.insideWorkspace).toBe(false);

    await rm(outside, { recursive: true, force: true });
  });

  it("handles non-existent path under workspace", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myagent-rp-"));

    const info = resolvePathInfo(tmpDir, "newdir/file.txt");
    expect(info).toBeDefined();
    expect(info!.insideWorkspace).toBe(true);
    expect(info!.missingRemainder).toBeTruthy();
  });

  it("handles non-existent path outside workspace", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myagent-rp-"));

    const info = resolvePathInfo(tmpDir, "/tmp/nonexistent_myagent_test/file.txt");
    expect(info).toBeDefined();
    expect(info!.insideWorkspace).toBe(false);
  });
});

// --- isSensitiveReadPath ---

describe("isSensitiveReadPath", () => {
  it("flags .env files", () => {
    expect(isSensitiveReadPath("/home/user/project/.env")).toBe(true);
    expect(isSensitiveReadPath("/home/user/project/.env.local")).toBe(true);
    expect(isSensitiveReadPath("/home/user/project/.env.production")).toBe(true);
  });

  it("flags SSH keys", () => {
    expect(isSensitiveReadPath("/home/user/.ssh/id_rsa")).toBe(true);
    expect(isSensitiveReadPath("/home/user/.ssh/id_ed25519")).toBe(true);
    expect(isSensitiveReadPath("/home/user/.ssh/config")).toBe(true);
  });

  it("flags credential/token files", () => {
    expect(isSensitiveReadPath("/home/user/secret.txt")).toBe(true);
    expect(isSensitiveReadPath("/home/user/credentials.json")).toBe(true);
    expect(isSensitiveReadPath("/home/user/api_token")).toBe(true);
  });

  it("flags .aws directory", () => {
    expect(isSensitiveReadPath("/home/user/.aws/config")).toBe(true);
  });

  it("flags .git directory", () => {
    expect(isSensitiveReadPath("/home/user/project/.git/config")).toBe(true);
  });

  it("does not flag normal files", () => {
    expect(isSensitiveReadPath("/home/user/project/src/index.ts")).toBe(false);
    expect(isSensitiveReadPath("/home/user/project/package.json")).toBe(false);
    expect(isSensitiveReadPath("/home/user/project/.gitignore")).toBe(false);
    expect(isSensitiveReadPath("/home/user/project/.prettierrc")).toBe(false);
  });

  it("flags .pem and .key files", () => {
    expect(isSensitiveReadPath("/home/user/cert.pem")).toBe(true);
    expect(isSensitiveReadPath("/home/user/server.key")).toBe(true);
  });

  it("flags .npmrc and .netrc", () => {
    expect(isSensitiveReadPath("/home/user/project/.npmrc")).toBe(true);
    expect(isSensitiveReadPath("/home/user/.netrc")).toBe(true);
  });

  it("does not flag .env.example", () => {
    expect(isSensitiveReadPath("/home/user/project/.env.example")).toBe(false);
  });

  it("does not flag .env.sample", () => {
    expect(isSensitiveReadPath("/home/user/project/.env.sample")).toBe(false);
  });

  it("does not flag .env.template", () => {
    expect(isSensitiveReadPath("/home/user/project/.env.template")).toBe(false);
  });

  it("does not flag .env.local.example", () => {
    expect(isSensitiveReadPath("/home/user/project/.env.local.example")).toBe(false);
  });

  it("does not flag .env.production.sample", () => {
    expect(isSensitiveReadPath("/home/user/project/.env.production.sample")).toBe(false);
  });

  it("still flags .env", () => {
    expect(isSensitiveReadPath("/home/user/project/.env")).toBe(true);
  });

  it("still flags .env.local", () => {
    expect(isSensitiveReadPath("/home/user/project/.env.local")).toBe(true);
  });
});

// --- checkReadPolicy ---

describe("checkReadPolicy", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("allows workspace read", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myagent-rp-"));
    await writeFile(join(tmpDir, "file.txt"), "content");

    const policy = checkReadPolicy(tmpDir, "file.txt");
    expect(policy.behavior).toBe("allow");
    expect(policy.reason).toContain("workspace");
  });

  it("asks for sensitive workspace read", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myagent-rp-"));
    await writeFile(join(tmpDir, ".env"), "SECRET=abc");

    const policy = checkReadPolicy(tmpDir, ".env");
    expect(policy.behavior).toBe("ask");
    expect(policy.reason).toContain("sensitive");
  });

  it("asks for outside workspace read", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myagent-rp-"));
    const sibling = `${tmpDir}-sibling`;
    await mkdir(sibling);
    await writeFile(join(sibling, "data.txt"), "data");

    const policy = checkReadPolicy(tmpDir, `../${sibling.split("/").at(-1)}/data.txt`);
    expect(policy.behavior).toBe("ask");
    expect(policy.reason).toContain("outside workspace");

    await rm(sibling, { recursive: true, force: true });
  });

  it("asks for symlink pointing outside workspace", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myagent-rp-"));
    const outside = await mkdtemp(join(tmpdir(), "myagent-outside-"));
    await writeFile(join(outside, "file.txt"), "content");
    await symlink(outside, join(tmpDir, "link"));

    const policy = checkReadPolicy(tmpDir, "link/file.txt");
    expect(policy.behavior).toBe("ask");
    expect(policy.reason).toContain("outside workspace");

    await rm(outside, { recursive: true, force: true });
  });

  it("denies unresolvable path", () => {
    const policy = checkReadPolicy("/nonexistent_workspace", "file.txt");
    expect(policy.behavior).toBe("deny");
    expect(policy.reason).toContain("cannot be resolved");
  });
});

describe("checkToolPermission search", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("does not exclude sensitive files when the sensitive path itself is approved", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myagent-rp-"));
    await writeFile(join(tmpDir, ".env"), "SECRET=abc");

    const decision = checkToolPermission(
      "search",
      { pattern: "SECRET", path: ".env" },
      "auto",
      tmpDir,
    );

    expect(decision.behavior).toBe("ask");
    expect((decision.resolvedInput as any).excludeSensitive).toBe(false);
  });

  it("excludes sensitive files for ordinary directory searches", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myagent-rp-"));
    await writeFile(join(tmpDir, "todo.md"), "SECRET=abc");

    const decision = checkToolPermission(
      "search",
      { pattern: "SECRET", path: "." },
      "auto",
      tmpDir,
    );

    expect(decision.behavior).toBe("allow");
    expect((decision.resolvedInput as any).excludeSensitive).toBe(true);
  });
});
