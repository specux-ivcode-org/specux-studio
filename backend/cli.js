#!/usr/bin/env node

const { runServerCommand } = require("./cli/serverCommands");
const {
  runInitCommand,
  runSchemaCommand,
  runValidateCommand,
  runVersionCommand
} = require("./cli/projectCommands");
const { runRenderCommand } = require("./cli/renderCommand");
const { inlineProjectResources } = require("./cli/browserRenderer");
const { locateProjectRoot, usage } = require("./cli/support");

/** Dispatches the server command group or the configured top-level command handler. */
async function dispatchCommand(command, args) {
  // Route the server command family before checking the other top-level commands.
  const handlers = new Map([
    ["init", runInitCommand],
    ["version", runVersionCommand],
    ["--version", runVersionCommand],
    ["-v", runVersionCommand],
    ["schema", runSchemaCommand],
    ["validate", runValidateCommand],
    ["render", runRenderCommand]
  ]);
  if (command === "server") {
    const [subcommand, ...subArgs] = args;
    if (!subcommand) {
      throw new Error("Usage: specux server <start|status|state|screenshot|annotations|update>");
    }
    return runServerCommand(subcommand, subArgs);
  }

  // Dispatch a known top-level command or show the supported usage.
  const handler = handlers.get(command);
  if (handler) return handler(args);
  throw new Error(`Unknown command "${command}".\n\n${usage()}`);
}

/** Prints help or routes CLI arguments to the matching command handler. */
async function main(args = process.argv.slice(2)) {
  // Show help when no command is supplied or help is explicitly requested.
  if (!args.length || args[0] === "--help" || args[0] === "-h") {
    console.log(usage());
    return;
  }

  // Pass the command and its remaining arguments to the dispatcher.
  const [command, ...rest] = args;
  return dispatchCommand(command, rest);
}

if (require.main === module) {
  main()

    // Apply a command's numeric exit status to the process.
    .then((exitCode) => {
      if (typeof exitCode === "number") process.exitCode = exitCode;
    })

    // Print command failures and set a nonzero process exit status.
    .catch((error) => {
      console.error(error.message || String(error));
      process.exitCode = 1;
    });
}

module.exports = {
  main,
  inlineProjectResources,
  locateProjectRoot,
  runInitCommand
};
