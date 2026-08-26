import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import { ArrowUpRight, X } from "@phosphor-icons/react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? "brand--compact" : ""}`} aria-label="Split View">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      {!compact && <span className="brand-word">Split View</span>}
    </span>
  );
}

export function Bezel({
  children,
  className = "",
  coreClassName = ""
}: PropsWithChildren<{ className?: string; coreClassName?: string }>) {
  return (
    <div className={`bezel ${className}`}>
      <div className={`bezel__core ${coreClassName}`}>{children}</div>
    </div>
  );
}

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>) {
  return (
    <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export function PrimaryButton({
  children,
  icon,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; icon?: ReactNode }) {
  return (
    <button type="button" className="primary-button group" {...props}>
      <span>{children}</span>
      <span className="primary-button__icon" aria-hidden="true">
        {icon ?? <ArrowUpRight size={16} weight="light" />}
      </span>
    </button>
  );
}

export function CloseButton({ onClick, label = "닫기" }: { onClick(): void; label?: string }) {
  return (
    <IconButton label={label} onClick={onClick}>
      <X size={18} weight="light" />
    </IconButton>
  );
}
