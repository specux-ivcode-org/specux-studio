const fs = require("node:fs/promises");
const path = require("node:path");

/** Tests whether a resolved path is the directory itself or one of its descendants. */
function isWithin(directory, target) {
  const relative = path.relative(directory, target);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** Rejects unsafe project-relative paths and returns their validated segments. */
function safeRelativePath(relativePath) {
  // Reject malformed paths before converting the remaining path into safe segments.
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\") ||
      path.posix.isAbsolute(relativePath) ||
      relativePath.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new Error(`"${String(relativePath)}" must be a normal relative project path.`);
  }
  return relativePath.split("/");
}

/** Resolves an existing project file or directory while preventing symlink escapes. */
async function resolveProjectPath(projectRoot, relativePath, expectedType) {
  // Resolve the project root and reject lexical paths that leave its boundary.
  const root = await fs.realpath(projectRoot);
  const target = path.resolve(root, ...safeRelativePath(relativePath));
  if (!isWithin(root, target)) throw new Error(`"${relativePath}" resolves outside the project.`);

  // Resolve symlinks and verify the final target remains within the real project root.
  const realTarget = await fs.realpath(target);
  if (!isWithin(root, realTarget)) throw new Error(`"${relativePath}" resolves outside the project.`);
  const stats = await fs.stat(realTarget);

  // Enforce the caller's expected file or directory type before returning the path.
  if (expectedType === "file" && !stats.isFile()) throw new Error(`"${relativePath}" is not a file.`);
  if (expectedType === "directory" && !stats.isDirectory()) throw new Error(`"${relativePath}" is not a directory.`);
  return realTarget;
}

module.exports = { isWithin, resolveProjectPath, safeRelativePath };
