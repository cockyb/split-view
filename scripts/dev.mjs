import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Launcher, launch } from "chrome-launcher";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = resolve(projectRoot, "node_modules/vite/bin/vite.js");
const distDir = resolve(projectRoot, "dist");
const profileDir = resolve(projectRoot, ".split-view-dev/chrome-profile");

const excludedChromeFlags = new Set([
  "--disable-component-update",
  "--disable-extensions",
  "--mute-audio"
]);

mkdirSync(profileDir, { recursive: true });

let browser;
let cdp;
let buildOutput = "";
let reloadQueue = Promise.resolve();
let stopping = false;

const buildWatcher = spawn(
  process.execPath,
  [viteBin, "build", "--watch", "--mode", "development"],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: ["inherit", "pipe", "inherit"]
  }
);

function createCdpClient({ incoming, outgoing }) {
  const pending = new Map();
  let buffer = "";
  let nextId = 0;

  incoming.setEncoding("utf8");
  incoming.on("data", (chunk) => {
    buffer += chunk;

    let boundary = buffer.indexOf("\0");
    while (boundary !== -1) {
      const rawMessage = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      boundary = buffer.indexOf("\0");

      if (!rawMessage) {
        continue;
      }

      const message = JSON.parse(rawMessage);
      const request = pending.get(message.id);
      if (!request) {
        continue;
      }

      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(message.error.message));
      } else {
        request.resolve(message.result);
      }
    }
  });

  incoming.once("close", () => {
    for (const request of pending.values()) {
      request.reject(new Error("Chrome 개발자 프로토콜 연결이 종료되었습니다."));
    }
    pending.clear();
  });

  return {
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolveRequest, rejectRequest) => {
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        outgoing.write(`${JSON.stringify({ id, method, params })}\0`);
      });
    }
  };
}

async function launchBrowser() {
  process.stdout.write(
    "\n[Split View] 빌드 완료. 확장 프로그램을 설치한 전용 Chrome을 엽니다.\n\n"
  );

  const chromeFlags = Launcher.defaultFlags().filter(
    (flag) => !excludedChromeFlags.has(flag)
  );
  chromeFlags.push(
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    "--disable-blink-features=AutomationControlled"
  );

  browser = await launch({
    chromePath: process.env.SPLIT_VIEW_BROWSER_PATH,
    chromeFlags,
    handleSIGINT: false,
    ignoreDefaultFlags: true,
    logLevel: "silent",
    prefs: { "extensions.ui.developer_mode": true },
    userDataDir: profileDir
  });

  if (!browser.remoteDebuggingPipes) {
    throw new Error("Chrome 개발자 프로토콜 파이프를 열지 못했습니다.");
  }

  cdp = createCdpClient(browser.remoteDebuggingPipes);
  browser.process.once("exit", () => {
    if (!stopping) {
      stop(0);
    }
  });
}

function reloadExtension() {
  reloadQueue = reloadQueue
    .then(async () => {
      if (!browser) {
        await launchBrowser();
      }

      await cdp.send("Extensions.loadUnpacked", { path: distDir });
      process.stdout.write(
        `[Split View] 확장 프로그램 로드 완료 · ${new Date().toLocaleTimeString()}\n`
      );
    })
    .catch((error) => {
      process.stderr.write(`[Split View] 확장 프로그램 로드 실패: ${error.message}\n`);
      stop(1);
    });
}

buildWatcher.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  buildOutput = `${buildOutput}${chunk.toString()}`.slice(-2_000);

  if (!/built in \d+(?:\.\d+)?(?:ms|s)\./.test(buildOutput)) {
    return;
  }

  buildOutput = "";
  reloadExtension();
});

buildWatcher.once("error", (error) => {
  process.stderr.write(`[Split View] 개발 빌드 실행 실패: ${error.message}\n`);
  stop(1);
});

buildWatcher.once("exit", (code, signal) => {
  if (stopping) {
    return;
  }

  if (signal) {
    process.stderr.write(`[Split View] 개발 빌드 종료: ${signal}\n`);
  }
  stop(code ?? 1);
});

function stop(exitCode) {
  if (stopping) {
    return;
  }
  stopping = true;

  if (!buildWatcher.killed) {
    buildWatcher.kill("SIGTERM");
  }

  try {
    browser?.kill();
  } catch {
    // Chrome이 먼저 종료된 경우에는 정리할 프로세스가 없다.
  }

  process.exitCode = exitCode;
}

process.once("SIGINT", () => stop(130));
process.once("SIGTERM", () => stop(143));
