import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const release = JSON.parse(readFileSync(join(root, "manifest", "release-lock.json"), "utf8"));

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("every bundled artifact has the pinned digest and package identity", () => {
  for (const artifact of release.artifacts) {
    const path = join(root, "packages", artifact.file);
    assert.equal(sha256(path), artifact.sha256, artifact.file);
    const packageJson = JSON.parse(execFileSync("tar.exe", ["-xOf", path, "package/package.json"], { encoding: "utf8" }));
    assert.equal(packageJson.name, artifact.package, artifact.file);
    assert.equal(packageJson.version, artifact.version, artifact.file);
    assert.equal(packageJson.license, artifact.license, artifact.file);
  }
});

test("app template and lockfile retain the exact DSH and local overrides", () => {
  const packageJson = JSON.parse(readFileSync(join(root, "templates", "app", "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "templates", "app", "package-lock.json"), "utf8"));
  assert.equal(packageJson.dependencies[release.base.package], release.base.version);
  assert.equal(lock.packages[""].dependencies[release.base.package], release.base.version);
  for (const artifact of release.artifacts.filter((entry) => entry.placement === "app")) {
    assert.ok(Object.values(packageJson.dependencies).includes(`file:.packages/${artifact.file}`), artifact.file);
  }
  assert.equal(packageJson.engines.node, release.node.version);
});

test("all source-based profile components pin immutable commits", () => {
  assert.match(release.profile.genui.commit, /^[a-f0-9]{40}$/u);
  for (const artifact of release.artifacts.filter((entry) => entry.commit)) {
    assert.match(artifact.commit, /^[a-f0-9]{40}$/u, artifact.package);
  }
});
