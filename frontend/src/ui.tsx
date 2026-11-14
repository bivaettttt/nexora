import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, AlertCircle } from "lucide-react";
import { short, stamp, type EventRow } from "./api";

export const titleState: Record<string, string> = {
  PENDING: "В очереди",
  RETRY: "Ожидает повтора",
  SUCCEEDED: "Доставлено",
  DEAD: "Исчерпано",
  QUARANTINED: "Карантин",
  APPLIED: "Применено",
  SAME: "Без изменений",
  STALE: "Устарело",
};

export function Badge({ status }: { status: string }) {
  const color = ["SUCCEEDED", "APPLIED", "SAME", "STALE", "UP"].includes(status)
    ? "good"
    : status === "PENDING" || status === "RETRY"
      ? "wait"
      : ["DEAD", "QUARANTINED", "DOWN"].includes(status)
        ? "bad"
        : "neutral";
  return (
    <span className={"badge " + color}>
      <i />
      {titleState[status] ?? status}
    </span>
  );
}
export function Heading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </header>
  );
}
export function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div className="error" role="alert">
      <AlertCircle size={17} />
      {error instanceof Error ? error.message : "Запрос не выполнен."}
    </div>
  ) : null;
}
export function Empty({
  pending,
  children,
}: {
  pending?: boolean;
  children?: ReactNode;
}) {
  return (
    <p className="empty">
      {pending ? "Загрузка…" : (children ?? "Записей пока нет.")}
    </p>
  );
}
export function Events({
  data,
  pending,
}: {
  data?: EventRow[];
  pending?: boolean;
}) {
  if (!data?.length) return <Empty pending={pending} />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Событие</th>
            <th>Источник</th>
            <th>Correlation ID</th>
            <th>Доставка</th>
            <th>Получено</th>
            <th aria-label="Детали" />
          </tr>
        </thead>
        <tbody>
          {data.map((e) => (
            <tr key={e.id}>
              <td>
                <Link to={"/messages/" + e.id}>
                  {e.type ?? "Ошибка контракта"}
                </Link>
                <small className="mono">
                  {short(e.id)}
                  {e.version && ` · v${e.version}`}
                </small>
              </td>
              <td>{e.source ?? "—"}</td>
              <td className="mono" title={e.correlation_id ?? ""}>
                {short(e.correlation_id)}
              </td>
              <td>
                {e.rejection ? (
                  <Badge status="QUARANTINED" />
                ) : (
                  <span className="count">
                    {e.succeeded}/{e.total}
                  </span>
                )}
              </td>
              <td>{stamp(e.received_at)}</td>
              <td>
                <Link aria-label={"Открыть " + e.id} to={"/messages/" + e.id}>
                  <ArrowUpRight size={16} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Json({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}
