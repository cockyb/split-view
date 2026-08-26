import { useEffect, useState } from "react";
import { DownloadSimple, LockKeyOpen, ShieldCheck } from "@phosphor-icons/react";
import { hasChromeRuntime } from "../shared/browser-api";
import { exportDiagnostics, saveSettings } from "../shared/storage";
import type { AppSettings } from "../shared/types";
import { Bezel, CloseButton } from "./common";

interface SettingsSheetProps {
  open: boolean;
  settings: AppSettings;
  onChange(settings: AppSettings): void;
  onClose(): void;
}

const REQUIRED_HOSTS = new Set([
  "api.chzzk.naver.com",
  "live.sooplive.com",
  "livestream-manager.sooplive.com",
  "chapi.sooplive.com",
  "live.sooplive.co.kr",
  "livestream-manager.sooplive.co.kr",
  "chapi.sooplive.co.kr"
]);

export function SettingsSheet({ open, settings, onChange, onClose }: SettingsSheetProps) {
  const [origins, setOrigins] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !hasChromeRuntime) return;
    void chrome.permissions.getAll().then((permissions) => {
      setOrigins((permissions.origins ?? []).filter((origin) => {
        try {
          const hostname = new URL(origin.replace("*.", "placeholder.").replace("*", "")).hostname.replace("placeholder.", "");
          return !REQUIRED_HOSTS.has(hostname);
        } catch {
          return false;
        }
      }));
    });
  }, [open]);

  if (!open) return null;

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...settings, [key]: value };
    onChange(next);
    void saveSettings(next);
  };

  const downloadDiagnostics = async () => {
    const blob = new Blob([await exportDiagnostics()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `split-view-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const removeOrigin = async (origin: string) => {
    if (!hasChromeRuntime) return;
    const removed = await chrome.permissions.remove({ origins: [origin] });
    if (removed) setOrigins((current) => current.filter((item) => item !== origin));
  };

  return (
    <div className="sheet-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <Bezel className="settings-sheet" coreClassName="settings-sheet__core">
        <header className="sheet-header">
          <div>
            <span className="eyebrow">Preferences</span>
            <h2>설정</h2>
          </div>
          <CloseButton onClick={onClose} />
        </header>

        <div className="setting-group">
          <label htmlFor="default-layout">기본 레이아웃</label>
          <select
            id="default-layout"
            value={settings.defaultLayout}
            onChange={(event) => update("defaultLayout", event.target.value as AppSettings["defaultLayout"])}
          >
            <option value="auto">자동</option>
            <option value="two-horizontal">2분할 가로</option>
            <option value="two-vertical">2분할 세로</option>
          </select>
        </div>

        <div className="setting-group">
          <label htmlFor="max-quality">자동 화질 상한</label>
          <select
            id="max-quality"
            value={settings.maxQualityHeight ?? ""}
            onChange={(event) => update("maxQualityHeight", event.target.value ? Number(event.target.value) : undefined)}
          >
            <option value="">제한 없음</option>
            <option value="1080">1080p</option>
            <option value="720">720p</option>
            <option value="540">540p</option>
          </select>
          <p>스트림이 3개 이상이면 선택하지 않은 타일은 최대 720p로 재생합니다.</p>
        </div>

        <div className="setting-group">
          <label htmlFor="hide-timeout">컨트롤 자동 숨김</label>
          <select
            id="hide-timeout"
            value={settings.controlsTimeoutMs}
            onChange={(event) => update("controlsTimeoutMs", Number(event.target.value) as AppSettings["controlsTimeoutMs"])}
          >
            <option value={1200}>1.2초</option>
            <option value={1800}>1.8초</option>
            <option value={3000}>3초</option>
          </select>
        </div>

        <label className="setting-toggle">
          <span>
            <strong>지난 구성 저장</strong>
            <small>URL, 순서, 레이아웃만 저장합니다.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.saveWorkspace}
            onChange={(event) => update("saveWorkspace", event.target.checked)}
          />
        </label>

        <div className="setting-fixed">
          <ShieldCheck size={18} weight="light" />
          <span>새 방송은 항상 음소거로 시작해요</span>
        </div>

        <div className="sheet-actions">
          <button type="button" className="secondary-button" onClick={() => void downloadDiagnostics()}>
            <DownloadSimple size={18} weight="light" />
            진단 로그 내보내기
          </button>
        </div>

        <section className="permission-list" aria-labelledby="permission-title">
          <div className="permission-list__title">
            <LockKeyOpen size={18} weight="light" />
            <h3 id="permission-title">CDN 접근 권한</h3>
          </div>
          {origins.length === 0 ? (
            <p>추가로 허용한 CDN이 없습니다.</p>
          ) : (
            <ul>
              {origins.map((origin) => (
                <li key={origin}>
                  <span>{new URL(origin.replace("*", "")).hostname}</span>
                  <button type="button" onClick={() => void removeOrigin(origin)}>해제</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Bezel>
    </div>
  );
}
