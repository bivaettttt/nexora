import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Copy, AlertCircle } from "lucide-react";
import { short, stamp, timelineStamp, type EventRow } from "./api";
import { intent, messageLink, outcomes } from "./presentation";

export const titleState: Record<string, string> = {
  UP: "Доступна",
  DOWN: "Недоступна",
  PENDING: "В очереди",
  RETRY: "Ожидает повтора",
  SUCCEEDED: "Доставлено",
  DEAD: "В DLQ",
  QUARANTINED: "Карантин",
  APPLIED: "Применено",
  SAME: "Без изменений",
  STALE: "Устарело",
};

export function Badge({ status }: { status: string }) {
  const color = ["SUCCEEDED", "APPLIED", "UP"].includes(status)
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
async function writeClipboard(text: string) {
  if (!navigator.clipboard) throw new Error("Clipboard unavailable");
  await navigator.clipboard.writeText(text);
}

export function CopyValue({ label, value }: { label: string; value: string }) {
  const [feedback, setFeedback] = useState("");
  return (
    <span className="copy-value">
      <code>{value}</code>
      <button
        type="button"
        aria-label={"Копировать " + label}
        onClick={() =>
          void writeClipboard(value).then(
            () => setFeedback("Скопировано"),
            () => setFeedback("Выделите и скопируйте вручную."),
          )
        }
      >
        <Copy size={14} aria-hidden="true" />
      </button>
      <small role="status">{feedback}</small>
    </span>
  );
}

export function Events({
  data,
  pending,
  search,
  empty,
}: {
  data?: EventRow[];
  pending?: boolean;
  search?: string;
  empty?: string;
}) {
  if (!data?.length) return <Empty pending={pending}>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table className="events-table">
        <thead>
          <tr>
            <th scope="col">Событие</th>
            <th scope="col">Назначения и результат</th>
            <th scope="col">Получено</th>
          </tr>
        </thead>
        <tbody>
          {data.map((e) => {
            const state = e.deliveries && intent(e.deliveries, e.rejection);
            return (
              <tr key={e.id}>
                <td>
                  <Link
                    to={messageLink(e.id, null, search)}
                    aria-label={"Открыть " + e.id}
                  >
                    {e.type ?? "Входной карантин"}
                  </Link>
                  <small className="mono">
                    {e.source ?? "Источник неизвестен"} · {short(e.id)}
                    {e.version ? " · v" + e.version : ""}
                  </small>
                  {e.correlation_id && (
                    <small className="mono" title={e.correlation_id}>
                      Correlation · {short(e.correlation_id)}
                    </small>
                  )}
                </td>
                <td>
                  {state ? (
                    <span className={"badge " + state.tone}>{state.text}</span>
                  ) : (
                    <span>
                      {e.succeeded} из {e.total} доставок завершены
                    </span>
                  )}
                  <div className="destination-list">
                    {e.deliveries?.map((d) => (
                      <div key={d.id}>
                        <Link
                          to={messageLink(e.id, d.id, search)}
                          aria-label={d.target + " · открыть доставку " + d.id}
                        >
                          {d.target}
                        </Link>{" "}
                        <Badge status={d.status} />
                        {d.outcome && (
                          <small title={outcomes[d.outcome]}>
                            {outcomes[d.outcome] ?? d.outcome}
                          </small>
                        )}
                        {d.status === "RETRY" && (
                          <small className="mono">
                            Следующая попытка · {timelineStamp(d.next_at)}
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                </td>
                <td>
                  <time dateTime={e.received_at}>{stamp(e.received_at)}</time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({
  text,
  language,
}: {
  text: string;
  language: "JSON" | "XML";
}) {
  const [feedback, setFeedback] = useState("");
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? text : text.slice(0, 12000);
  const tokens = shown.split(
    language === "JSON"
      ? /("(?:[^"\\]|\\.)*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b)/g
      : /(<[^>]+>)/g,
  );
  return (
    <div className="code-view">
      <div className="code-tools">
        <span>
          {language} · {text.length.toLocaleString("ru-RU")} зн.
        </span>
        <button
          type="button"
          onClick={() =>
            void writeClipboard(text).then(
              () => setFeedback("Скопировано"),
              () => setFeedback("Копирование недоступно"),
            )
          }
        >
          Копировать {language}
        </button>
        <span role="status">{feedback}</span>
      </div>
      <pre tabIndex={0} aria-label={"Содержимое " + language}>
        <code>
          {tokens.map((part, i) =>
            i % 2 ? (
              <span className="syntax-token" key={i}>
                {part}
              </span>
            ) : (
              part
            ),
          )}
        </code>
      </pre>
      {text.length > 12000 && (
        <button
          type="button"
          className="code-expand"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Свернуть" : "Показать полностью"}
        </button>
      )}
    </div>
  );
}
export function Json({ value }: { value: unknown }) {
  return (
    <CodeBlock
      text={JSON.stringify(value, null, 2) ?? "null"}
      language="JSON"
    />
  );
}
export function SoapExample({ fields }: { fields: Record<string, unknown> }) {
  const escaped = (value: unknown) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const body = ["GlobalId", "Version", "LegalName"]
    .map(
      (field) =>
        "      <p:" +
        field +
        ">" +
        escaped(fields[field]) +
        "</p:" +
        field +
        ">",
    )
    .join("\n");
  const text =
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:p="urn:nexora:partner:v1">\n  <soap:Body>\n    <p:UpsertPartner>\n' +
    body +
    "\n    </p:UpsertPartner>\n  </soap:Body>\n</soap:Envelope>";
  return <CodeBlock language="XML" text={text} />;
}
