import type { ReactNode } from "react";

export function Metric({ label, value, detail, icon }: { label: string; value: string | number; detail?: string; icon?: ReactNode }) {
  return (
    <div className="metric">
      <span className="metric-label">
        {icon ? <span className="metric-icon">{icon}</span> : <span className="metric-dot" aria-hidden />}
        {label}
      </span>
      <strong>{value}</strong>
      {detail ? <span className="metric-detail">{detail}</span> : null}
    </div>
  );
}

export function Confidence({ value }: { value: number }) {
  const percentage = Math.round(Math.min(1, Math.max(0, value)) * 100);

  return (
    <span className="confidence" aria-label={`${percentage}% confidence`} title={`${percentage}% confidence`}>
      <span className="confidence-track" aria-hidden>
        <span className="confidence-fill" style={{ width: `${percentage}%` }} />
      </span>
      <strong className="confidence-value">{percentage}%</strong>
    </span>
  );
}

export function Status({ children, tone = "ok" }: { children: React.ReactNode; tone?: "ok" | "warning" | "private" | "danger" }) {
  const className = tone === "ok" ? "status" : `status ${tone}`;
  return <span className={className}>{children}</span>;
}

export function TableScroll({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function PersonMonogram({ name, variant = "profile" }: { name: string; variant?: "profile" | "small" }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length <= 1 ? (parts[0] ?? "?").slice(0, 2) : `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`;

  return (
    <span className={`person-monogram person-monogram--${variant}`} aria-hidden>
      {initials.toUpperCase()}
    </span>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state-card">
      {icon ? <span className="empty-state-icon">{icon}</span> : null}
      <div>
        <strong>{title}</strong>
        <div className="muted">{children}</div>
      </div>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
