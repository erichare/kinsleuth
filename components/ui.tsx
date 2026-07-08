export function Metric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

export function Confidence({ value }: { value: number }) {
  const stars = Math.max(1, Math.round(value * 5));
  return (
    <span className="score" title={`${Math.round(value * 100)}% confidence`}>
      {"★".repeat(stars)}
      {"☆".repeat(5 - stars)}
    </span>
  );
}

export function Status({ children, tone = "ok" }: { children: React.ReactNode; tone?: "ok" | "warning" | "private" | "danger" }) {
  const className = tone === "ok" ? "status" : `status ${tone}`;
  return <span className={className}>{children}</span>;
}
