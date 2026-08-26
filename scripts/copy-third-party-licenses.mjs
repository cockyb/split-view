import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(projectRoot, "dist");

const files = [
  ["LICENSE", "LICENSE.txt"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
  ["node_modules/@fontsource-variable/geist/LICENSE", "third-party-licenses/geist-OFL-1.1.txt"],
  ["node_modules/@phosphor-icons/react/LICENSE", "third-party-licenses/phosphor-icons-MIT.txt"],
  ["node_modules/hls.js/LICENSE", "third-party-licenses/hls.js-Apache-2.0.txt"],
  ["node_modules/react/LICENSE", "third-party-licenses/react-MIT.txt"],
  ["node_modules/react-dom/LICENSE", "third-party-licenses/react-dom-MIT.txt"]
];

for (const [sourceName, targetName] of files) {
  const source = resolve(projectRoot, sourceName);
  const target = resolve(outputRoot, targetName);
  if (!existsSync(source)) {
    throw new Error(`라이선스 파일을 찾을 수 없습니다: ${sourceName}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
