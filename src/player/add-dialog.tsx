import { FormEvent, useMemo, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { adapterForUrl, normalizeStreamUrl } from "../adapters";
import { toPlaybackIssue } from "../shared/errors";
import type { StreamSource } from "../shared/types";
import { Bezel, CloseButton } from "../ui/common";

export function AddDialog({ onAdd, onClose }: { onAdd(source: StreamSource): void; onClose(): void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const valid = useMemo(() => input.trim().length > 0 && Boolean(adapterForUrl(input)), [input]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) {
      setError("지원하는 치지직 또는 SOOP 라이브 링크를 입력해 주세요.");
      return;
    }
    try {
      onAdd(await normalizeStreamUrl(input));
      onClose();
    } catch (caught) {
      setError(toPlaybackIssue(caught).message);
    }
  };

  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <Bezel className="add-dialog" coreClassName="add-dialog__core">
        <header>
          <div>
            <span className="eyebrow">New stream</span>
            <h2>방송 추가</h2>
          </div>
          <CloseButton onClick={onClose} />
        </header>
        <p>치지직 또는 SOOP의 공개 라이브 링크를 입력하세요.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="player-stream-url" className="sr-only">라이브 링크</label>
          <input
            id="player-stream-url"
            autoFocus
            type="url"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setError("");
            }}
            placeholder="https://"
            aria-invalid={input.length > 0 && !valid}
          />
          <button type="submit" aria-label="추가" disabled={!valid}>
            <ArrowRight size={19} weight="light" />
          </button>
        </form>
        {error && <p className="dialog-error" role="alert">{error}</p>}
      </Bezel>
    </div>
  );
}
