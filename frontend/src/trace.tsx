import { useRef, useState } from "react";
import {
  Link,
  useLocation,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCommitHorizontal, RefreshCw, Waypoints } from "lucide-react";
import {
  api,
  ApiError,
  timelineStamp,
  type Delivery,
  type Detail,
  type Viewer,
} from "./api";
import { intent, messageLink, outcomes, protocol } from "./presentation";
import {
  Badge,
  CopyValue,
  Empty,
  ErrorBox,
  Heading,
  Json,
  Panel,
  SoapExample,
} from "./ui";

function Moment({ value }: { value: string }) {
  return <time dateTime={value}>{timelineStamp(value)}</time>;
}

function Inspector({
  delivery,
  customer,
  eventType,
}: {
  delivery: Delivery;
  customer: string | null;
  eventType: string | null;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const replayAction = useRef<HTMLButtonElement>(null);
  const replayStatus = useRef<HTMLParagraphElement>(null);
  const { role } = useOutletContext<Viewer>();
  const query = useQueryClient();
  const replay = useMutation({
    mutationFn: () =>
      api<{ generation: number }>(
        "/deliveries/" + delivery.id + "/replay",
        "POST",
      ),
    onSuccess: () => {
      setConfirmed(false);
      requestAnimationFrame(() => replayStatus.current?.focus());
      void query.invalidateQueries({ queryKey: ["trace"] });
      void query.invalidateQueries({ queryKey: ["issues"] });
      void query.invalidateQueries({ queryKey: ["events"] });
    },
  });
  const latest = delivery.attempts.at(-1);
  const generation = replay.data?.generation;
  const awaitingReplay =
    generation !== undefined && delivery.generation < generation;
  function toggleConfirmation(next: boolean) {
    setConfirmed(next);
    requestAnimationFrame(() => replayAction.current?.focus());
  }
  const groups = new Map<number, Delivery["attempts"]>();
  for (const attempt of delivery.attempts) {
    const series = groups.get(attempt.generation);
    if (series) series.push(attempt);
    else groups.set(attempt.generation, [attempt]);
  }
  const outcome = delivery.outcome;
  const isFailure = delivery.status === "RETRY" || delivery.status === "DEAD";
  const recovered = delivery.status === "SUCCEEDED" && delivery.generation > 0;
  const action =
    delivery.status === "RETRY"
      ? "Дождитесь следующей попытки. Ручное восстановление доступно из DLQ."
      : delivery.status === "DEAD"
        ? "Проверьте причину отказа и состояние получателя, затем решите, нужен ли повтор."
        : recovered
          ? "Сверьте проекцию, если требуется подтвердить состояние данных."
          : "Изучите итог обработки получателя.";
  return (
    <Panel
      title={"Доставка · " + delivery.target}
      action={<Badge status={delivery.status} />}
    >
      <div className="inspector-body" aria-live="off">
        <dl className="trace-meta">
          <div>
            <dt>Delivery ID</dt>
            <dd>
              <CopyValue label="Delivery ID" value={delivery.id} />
            </dd>
          </div>
          <div>
            <dt>Протокол</dt>
            <dd>{protocol[delivery.target] ?? "—"}</dd>
          </div>
          <div>
            <dt>Попыток всего</dt>
            <dd>
              {delivery.attempts.length} · серия {delivery.generation + 1}
            </dd>
          </div>
          {latest && (
            <div>
              <dt>Последняя попытка</dt>
              <dd>
                <Moment value={latest.started_at} />
              </dd>
            </div>
          )}
          {delivery.status === "RETRY" && (
            <div>
              <dt>Следующая попытка</dt>
              <dd>
                <Moment value={delivery.next_at} />
              </dd>
            </div>
          )}
        </dl>
        <div className={"diagnosis " + (isFailure ? "diagnosis-failure" : "")}>
          <h3>{isFailure ? "Разбор ошибки" : "Результат обработки"}</h3>
          <p>
            <strong>
              {outcome
                ? (outcomes[outcome] ?? outcome)
                : "Результат пока неизвестен"}
            </strong>
            {outcome && (
              <>
                {" "}
                · <code>{outcome}</code>
              </>
            )}
          </p>
          {isFailure && latest?.http_status != null && (
            <p className="muted">
              Ответ {delivery.target} · HTTP {latest.http_status} · серия{" "}
              {latest.generation + 1}, попытка {latest.number}
            </p>
          )}
          <p>
            {action}{" "}
            {customer && (
              <Link to={"/reconcile?customer=" + customer}>Открыть сверку</Link>
            )}
          </p>
          {delivery.status === "DEAD" && (
            <p>
              <Link to="/dlq">Открыть активную очередь DLQ</Link>
            </p>
          )}
        </div>
        {generation !== undefined && (
          <p className="notice" role="status" ref={replayStatus} tabIndex={-1}>
            {awaitingReplay ||
            delivery.status === "PENDING" ||
            delivery.status === "RETRY"
              ? "Запрос на повтор принят. Ожидается результат серии " +
                (generation + 1) +
                "."
              : recovered
                ? "Восстановление завершено. Delivery ID сохранён."
                : "Новая серия завершилась отказом. Смотрите историю."}
          </p>
        )}
        <ErrorBox error={replay.error} />
        {delivery.status === "DEAD" && !awaitingReplay && role !== "viewer" && (
          <div className="recovery-action">
            {!confirmed ? (
              <button
                type="button"
                ref={replayAction}
                onClick={() => toggleConfirmation(true)}
              >
                <RefreshCw size={16} aria-hidden="true" /> Подготовить повтор
              </button>
            ) : (
              <>
                <p>
                  Получатель получит новый вызов для этой доставки. Предыдущие
                  попытки останутся в истории.
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    ref={replayAction}
                    disabled={replay.isPending}
                    onClick={() => replay.mutate()}
                  >
                    Повторить доставку
                  </button>
                  <button
                    type="button"
                    disabled={replay.isPending}
                    onClick={() => toggleConfirmation(false)}
                  >
                    Отмена
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <section className="timeline" aria-label="История доставки">
          <h3>История доставки</h3>
          {!latest && <Empty>Ожидается первая попытка.</Empty>}
          {[...groups].map(([series, attempts]) => (
            <section key={series} className="series">
              <h4>
                <GitCommitHorizontal size={18} aria-hidden="true" /> Серия{" "}
                {series + 1} ·{" "}
                {series ? "Ручное восстановление" : "Исходная обработка"}
              </h4>
              {series > 0 && delivery.replays?.[series - 1] && (
                <p className="muted">
                  Повтор запрошен{" "}
                  <Moment value={delivery.replays[series - 1].created_at} />
                </p>
              )}
              <ol>
                {attempts.map((a) => (
                  <li key={a.id}>
                    <div className="attempt-title">
                      <strong>Попытка {a.number}</strong>
                      <Moment value={a.started_at} />
                    </div>
                    <p>
                      {outcomes[a.outcome] ?? a.outcome}{" "}
                      <code>{a.outcome}</code>
                    </p>
                    <small>
                      Attempt ID {a.id} ·{" "}
                      {a.http_status == null
                        ? "Нет HTTP-ответа"
                        : "HTTP " + a.http_status}{" "}
                      · {a.duration_ms} мс
                    </small>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </section>
        <details className="payload">
          <summary>Преобразование и поля назначения</summary>
          <dl className="payload-fields">
            {Object.entries(delivery.transformation).map(([field, value]) => (
              <div key={field}>
                <dt>{field}</dt>
                <dd>{value == null ? "null" : String(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            Протокол {protocol[delivery.target]} ·{" "}
            {delivery.target === "ERP"
              ? "POST /soap · UpsertPartner"
              : eventType === "customer.payment"
                ? "PUT /v1/customers/{id}/payment-projection"
                : "PUT /v1/customers/{id}"}
            . История содержит HTTP-коды, длительность и исходы.
          </p>
          <div className="actions">
            {delivery.target === "ERP" ? (
              <>
                <a href="/contracts/partner.wsdl">ERP WSDL</a>
                <a href="/contracts/partner.xsd">ERP XSD</a>
              </>
            ) : (
              <a
                href={
                  "/contracts/" +
                  delivery.target.toLowerCase() +
                  ".openapi.json"
                }
              >
                REST OpenAPI
              </a>
            )}
          </div>
          <details>
            <summary>Поля назначения · JSON</summary>
            <Json value={delivery.transformation} />
          </details>
          {delivery.target === "ERP" && (
            <details>
              <summary>SOAP Envelope · реконструкция</summary>
              <p className="muted">
                XML собран из вычисленных полей назначения. Запись сетевого
                трафика недоступна.
              </p>
              <SoapExample fields={delivery.transformation} />
            </details>
          )}
        </details>
      </div>
    </Panel>
  );
}

export function Message() {
  const { id } = useParams();
  return <Trace key={id} id={id ?? ""} />;
}

function Trace({ id }: { id: string }) {
  const loc = useLocation();
  const [params, setParams] = useSearchParams();
  const [openedAt] = useState(Date.now);
  const expected = loc.state?.publication === id;
  const data = useQuery({
    queryKey: ["trace", id],
    queryFn: () => api<Detail>("/messages/" + id),
    refetchInterval: (q) => {
      if (
        expected &&
        q.state.error instanceof ApiError &&
        q.state.error.status === 404 &&
        Date.now() - openedAt < 30000
      )
        return 1200;
      return q.state.data?.deliveries.some(
        (d) => d.status === "PENDING" || d.status === "RETRY",
      )
        ? 1200
        : false;
    },
  });
  const from = params.get("from");
  const query = params.get("registry");
  const back =
    from === "/dlq" || from === "/errors"
      ? from
      : "/messages" + (query ? "?" + query : "");
  const backLabel =
    from === "/dlq"
      ? "Очередь DLQ"
      : from === "/errors"
        ? "Мониторинг ошибок"
        : "Журнал сообщений";
  const backLink = (
    <Link className="back-link" to={back}>
      ← {backLabel}
    </Link>
  );
  if (data.isPending)
    return (
      <>
        {backLink}
        <Empty pending />
      </>
    );
  if (!data.data) {
    if (
      expected &&
      data.error instanceof ApiError &&
      data.error.status === 404 &&
      Date.now() - openedAt < 30000
    )
      return (
        <>
          {backLink}
          <Heading
            title="Ожидается приём события"
            subtitle="Источник подтвердил запись. Событие ещё не доступно для трассировки."
          />
          <CopyValue label="Event ID" value={id ?? "—"} />
          <p role="status" className="notice">
            Проверяем поступление события в журнал.
          </p>
        </>
      );
    return (
      <>
        {backLink}
        <Heading title="Событие недоступно" subtitle={id ?? ""} />
        <ErrorBox error={data.error} />
        <button onClick={() => void data.refetch()}>
          Проверить журнал ещё раз
        </button>
      </>
    );
  }
  const { event, deliveries, related } = data.data;
  const aggregate = intent(deliveries, event.rejection);
  const selected =
    deliveries.find((d) => d.id === params.get("delivery")) ??
    deliveries.find((d) => d.status === "DEAD" || d.status === "RETRY") ??
    deliveries[0];
  const envelope = event.payload as {
    occurred_at?: string;
    schema_version?: number;
    data?: unknown;
  } | null;
  return (
    <>
      {backLink}
      <Heading
        title={event.type ?? "Событие в карантине"}
        subtitle="Трассировка сообщения"
      >
        <span className={"badge " + aggregate.tone} role="status">
          {aggregate.text}
        </span>
      </Heading>
      <ErrorBox error={data.error} />
      <Panel title="Источник и приём">
        <dl className="trace-meta trace-header">
          <div>
            <dt>Источник</dt>
            <dd>
              <strong>{event.source ?? "Не определён"}</strong>
              {event.version ? " · версия " + event.version : ""}
            </dd>
          </div>
          <div>
            <dt>Event ID</dt>
            <dd>
              <CopyValue label="Event ID" value={event.id} />
            </dd>
          </div>
          <div>
            <dt>Correlation ID</dt>
            <dd>
              {event.correlation_id ? (
                <CopyValue
                  label="Correlation ID"
                  value={event.correlation_id}
                />
              ) : (
                "Отсутствует"
              )}
            </dd>
          </div>
          {envelope?.occurred_at && (
            <div>
              <dt>Возникло у источника</dt>
              <dd>
                <Moment value={envelope.occurred_at} />
              </dd>
            </div>
          )}
          <div>
            <dt>Зарегистрировано в Nexora</dt>
            <dd>
              <Moment value={event.received_at} />
            </dd>
          </div>
          {event.customer_id && (
            <div>
              <dt>Клиент</dt>
              <dd>
                <Link to={"/reconcile?customer=" + event.customer_id}>
                  {event.customer_id}
                </Link>
              </dd>
            </div>
          )}
        </dl>
      </Panel>
      {event.rejection && (
        <Panel title="Входной карантин">
          <div className="inspector-body">
            <p>
              <strong>{outcomes[event.rejection] ?? event.rejection}</strong> ·{" "}
              <code>{event.rejection}</code>
            </p>
            <p>
              Получатели не назначены. Исходное тело недоступно. Ниже показаны
              сохранённые метаданные.
            </p>
          </div>
        </Panel>
      )}
      {selected && (
        <>
          <h2 className="section-title">
            <Waypoints size={19} aria-hidden="true" /> Независимые доставки
          </h2>
          <div
            className="destinations"
            role="group"
            aria-label="Выбор доставки"
          >
            {deliveries.map((d) => (
              <button
                type="button"
                key={d.id}
                aria-pressed={selected.id === d.id}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set("delivery", d.id);
                  setParams(next, { replace: true });
                }}
              >
                <span>
                  <strong>{d.target}</strong>
                  <small>{protocol[d.target]}</small>
                </span>
                <Badge status={d.status} />
                <span className="destination-outcome">
                  {d.outcome
                    ? (outcomes[d.outcome] ?? d.outcome)
                    : "Результат ожидается"}
                </span>
              </button>
            ))}
          </div>
          <Inspector
            key={selected.id}
            delivery={selected}
            customer={event.customer_id}
            eventType={event.type}
          />
        </>
      )}
      <Panel
        title={
          event.rejection ? "Метаданные карантина" : "Данные входного события"
        }
      >
        <details className="payload">
          <summary>Полезная нагрузка · JSON</summary>
          {envelope?.data != null && <Json value={envelope.data} />}
          <details>
            <summary>Полный сохранённый envelope</summary>
            <Json value={event.payload} />
          </details>
        </details>
      </Panel>
      <Panel title="Связанные события">
        {related.length ? (
          <>
            <p className="related-hint muted">
              Совпадение по клиенту или Correlation ID
            </p>
            <ul className="related">
              {related.map((r) => (
                <li key={r.id}>
                  <Link to={messageLink(r.id, null, query ?? undefined)}>
                    {r.type ?? "Событие"} · <code>{r.id.slice(0, 8)}</code>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Empty />
        )}
      </Panel>
    </>
  );
}
