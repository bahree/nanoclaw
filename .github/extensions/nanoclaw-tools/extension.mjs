import { joinSession } from "@github/copilot-sdk/extension";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const isWindows = process.platform === "win32";

function run(cmd) {
  return new Promise((resolve) => {
    const [shell, args] = isWindows
      ? ["powershell", ["-NoProfile", "-Command", cmd]]
      : ["bash", ["-c", cmd]];
    execFile(shell, args, { timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || stderr || err?.message || "").trim() });
    });
  });
}

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      await session.log("NanoClaw tools ready", { ephemeral: true });
    },
  },
  tools: [
    {
      name: "check_prerequisites",
      description:
        "Check NanoClaw prerequisites: Node.js version, npm dependencies, .env credentials, Docker status, and container image. Run this first during setup or debugging.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const lines = [];

        // Node.js
        const node = await run("node --version");
        const ver = node.output.replace("v", "").split(".")[0];
        lines.push(`Node.js: ${node.output} ${parseInt(ver) >= 20 ? "✓" : "✗ need 20+"}`);

        // npm deps
        const hasDeps = existsSync("node_modules") && existsSync("node_modules/better-sqlite3");
        lines.push(`node_modules: ${hasDeps ? "✓" : "✗ run npm install"}`);

        // TypeScript build
        lines.push(`dist/index.js: ${existsSync("dist/index.js") ? "✓" : "✗ run npm run build"}`);

        // .env + credentials
        let cred = "✗ missing";
        if (existsSync(".env")) {
          const env = readFileSync(".env", "utf-8");
          if (env.includes("ANTHROPIC_API_KEY=sk-")) cred = "✓ API key";
          else if (env.includes("CLAUDE_CODE_OAUTH_TOKEN=sk-")) cred = "✓ OAuth token";
          else if (env.includes("ONECLI_URL=")) cred = "✓ OneCLI (verify: onecli secrets list)";
        }
        lines.push(`.env credentials: ${cred}`);

        // Docker
        const docker = await run("docker info 2>&1");
        lines.push(`Docker: ${docker.ok ? "✓ running" : "✗ not running"}`);

        // Container image
        const img = await run(
          'docker image inspect nanoclaw-agent:latest --format "exists" 2>&1'
        );
        lines.push(
          `nanoclaw-agent image: ${img.output.includes("exists") ? "✓ built" : "✗ not built (run ./container/build.sh)"}`
        );

        // Registered groups
        if (existsSync("store/messages.db")) {
          const groups = await run(
            `sqlite3 store/messages.db "SELECT COUNT(*) FROM registered_groups" 2>&1`
          );
          lines.push(`Registered groups: ${groups.output || "0"}`);
        }

        return lines.join("\n");
      },
    },

    {
      name: "run_tests",
      description: "Run the NanoClaw test suite (vitest). Returns pass/fail summary.",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description: "Optional: specific test file path (e.g. src/db.test.ts)",
          },
        },
      },
      handler: async (args) => {
        const cmd = args.file ? `npx vitest run ${args.file} 2>&1` : "npm test 2>&1";
        const result = await run(cmd);
        const summary = result.output
          .split("\n")
          .filter((l) =>
            ["Test Files", "Tests ", "FAIL ", "Duration", "✓", "×"].some((k) => l.includes(k))
          )
          .slice(-15)
          .join("\n");
        return summary || result.output.slice(-1500);
      },
    },

    {
      name: "rebuild_native_modules",
      description:
        "Rebuild native Node.js modules (better-sqlite3, rollup). Run after switching between Windows and WSL2, or after npm install produces native module errors.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const result = await run("npm run rebuild 2>&1");
        return result.ok ? "✓ Native modules rebuilt." : `✗ Rebuild failed:\n${result.output}`;
      },
    },

    {
      name: "rebuild_container",
      description:
        "Rebuild the NanoClaw agent Docker container image. Requires bash (Linux/macOS/WSL2). Set clean=true to prune the builder cache first.",
      parameters: {
        type: "object",
        properties: {
          clean: {
            type: "boolean",
            description: "Prune Docker builder cache before building (slower but guaranteed fresh)",
          },
        },
      },
      handler: async (args) => {
        if (isWindows)
          return "Container rebuild requires bash. Run in WSL2: docker builder prune -f && ./container/build.sh";
        const cmd = args.clean
          ? "docker builder prune -f 2>&1 && ./container/build.sh 2>&1"
          : "./container/build.sh 2>&1";
        const result = await run(cmd);
        const tail = result.output.split("\n").slice(-10).join("\n");
        return result.ok ? `✓ Container built.\n${tail}` : `✗ Build failed:\n${tail}`;
      },
    },

    {
      name: "get_service_status",
      description: "Check if the NanoClaw background service is running.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const lines = [];

        if (process.platform === "darwin") {
          const r = await run("launchctl list 2>&1 | grep nanoclaw");
          lines.push(`launchd: ${r.output || "not loaded"}`);
        } else if (process.platform === "linux") {
          const user = await run("systemctl --user is-active nanoclaw 2>&1");
          lines.push(`systemd --user: ${user.output}`);
          const sys = await run("systemctl is-active nanoclaw 2>&1");
          if (sys.output !== user.output) lines.push(`systemd (root): ${sys.output}`);
          // WSL fallback: check for node process
          const ps = await run("pgrep -a node 2>&1 | grep dist/index");
          if (ps.ok) lines.push(`process: ${ps.output}`);
        } else {
          // Windows
          const ps = await run(
            "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*dist/index*' } | Select-Object Id, CPU | Format-Table -AutoSize"
          );
          lines.push(ps.output || "No NanoClaw process found");
        }

        return lines.join("\n") || "Could not determine service status";
      },
    },

    {
      name: "tail_logs",
      description: "Get the last N lines from a NanoClaw log file.",
      parameters: {
        type: "object",
        properties: {
          log: {
            type: "string",
            enum: ["main", "error", "container"],
            description:
              "main = logs/nanoclaw.log, error = logs/nanoclaw.error.log, container = most recent container run log",
          },
          lines: {
            type: "number",
            description: "Number of lines to return (default: 50)",
          },
        },
      },
      handler: async (args) => {
        const n = args.lines || 50;
        let logPath;

        if (args.log === "error") {
          logPath = "logs/nanoclaw.error.log";
        } else if (args.log === "container") {
          const find = await run(
            isWindows
              ? "Get-ChildItem -Path groups -Recurse -Filter 'container-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"
              : "ls -t groups/*/logs/container-*.log 2>/dev/null | head -1"
          );
          logPath = find.output;
        } else {
          logPath = "logs/nanoclaw.log";
        }

        if (!logPath || !existsSync(logPath)) {
          return `Log not found: ${logPath || "(no log path)"}`;
        }

        const result = await run(
          isWindows ? `Get-Content "${logPath}" -Tail ${n}` : `tail -n ${n} "${logPath}"`
        );
        return result.output || "(empty)";
      },
    },

    {
      name: "query_db",
      description:
        "Run a read-only SQLite query against the NanoClaw database (store/messages.db). Useful for checking registered groups, scheduled tasks, session IDs, message cursors.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "SQL SELECT query. Tables: messages, chats, sessions, registered_groups, router_state, scheduled_tasks, task_run_logs",
          },
        },
        required: ["query"],
      },
      handler: async (args) => {
        if (!existsSync("store/messages.db")) return "Database not found (store/messages.db)";
        // Only allow SELECT
        if (!/^\s*SELECT\b/i.test(args.query)) return "Only SELECT queries are allowed.";
        const escaped = args.query.replace(/"/g, '\\"');
        const result = await run(`sqlite3 store/messages.db "${escaped}" 2>&1`);
        return result.output || "(no results)";
      },
    },
  ],
});
