import { useRef, useState, type FormEvent } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  ApiError,
  short,
  type Broker,
  type Customer,
  type Issue,
  type Publication,
  type Reconciliation,
  type Viewer,
} from "./api";
import { Badge, Empty, ErrorBox, Heading, Json, Panel } from "./ui";

const uncertainKey = "nexora:payment-checks";
type UncertainPayments = Record<string, string>;

function loadChecks(): UncertainPayments {
  try {
    return JSON.parse(sessionStorage.getItem(uncertainKey) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
function rememberChecks(next: UncertainPayments) {
  try {
    sessionStorage.setItem(uncertainKey, JSON.stringify(next));
  } catch {
    /* keep the current page guard */
  }
}

export function Customers() {
  const { role } = useOutletContext<Viewer>();
  const data = useQuery({
    queryKey: ["customers"],
    queryFn: () => api<Customer[]>("/customers"),
  });
  const [edit, setEdit] = useState<Customer | null>(null);
  const [checks, setChecks] = useState(loadChecks);
  const currentChecks = useRef(checks);
  function updateCheck(id: string, reason?: string) {
    const next = { ...currentChecks.current };
    if (reason) next[id] = reason;
    else delete next[id];
    currentChecks.current = next;
    rememberChecks(next);
    setChecks(next);
  }
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: ({
      path,
      method,
      body,
    }: {
      path: string;
      method: string;
      body: unknown;
      payment?: string;
    }) => api<Publication>(path, method, body),
    onSuccess: async (result, variables) => {
      if (variables.payment) {
        updateCheck(variables.payment);
      } else {
        // A read begun before the write may still hold an older CRM snapshot.
        await qc.cancelQueries({ queryKey: ["customers"] });
        qc.setQueryData<Customer[]>(["customers"], (list) => [
          result.record,
          ...(list ?? []).filter((record) => record.id !== result.record.id),
        ]);
      }
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (error, variables) => {
      const id = variables.payment;
      if (id && error instanceof ApiError && error.uncertain) {
        const reason = error.status
          ? "Ответ HTTP " + error.status
          : error.message;
        updateCheck(id, reason);
      } else if (id) {
        updateCheck(id);
      }
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    change.mutate({
      path: edit ? "/customers/" + edit.id : "/customers",
      method: edit ? "PUT" : "POST",
      body: {
        name: form.get("name"),
        email: String(form.get("email")).trim() || null,
      },
    });
  }
  return (
    <>
      <Heading
        title="Клиенты CRM"
        subtitle="Создание и обновление источника, запуск оплаты в Billing"
      />
      <ErrorBox
        error={
          data.error ??
          (change.variables?.payment &&
          change.error instanceof ApiError &&
          change.error.uncertain
            ? null
            : change.error)
        }
      />
      {change.data && (
        <div className="notice" role="status">
          {change.variables?.payment
            ? "Billing подтвердил запись оплаты."
            : "CRM сохранила профиль."}{" "}
          <Link
            to={"/messages/" + change.data.event_id}
            state={{ publication: change.data.event_id }}
          >
            Открыть событие {short(change.data.event_id)}
          </Link>
        </div>
      )}
      {Object.entries(checks)
        .filter(([id]) => !change.isPending || change.variables?.payment !== id)
        .map(([id, reason]) => (
          <div className="uncertain-command" key={id}>
            <div role="status">
              <h2>Результат операции пока неизвестен</h2>
              <p>
                {reason}. Команда оплаты была отправлена, подтверждение
                результата не получено. Billing мог сохранить оплату. Повтор
                может создать ещё одну версию.
              </p>
              <p>
                Клиент <code>{id}</code> · Event ID из ответа недоступен.
              </p>
            </div>
            <div className="actions">
              <Link
                to={
                  "/messages?source=Billing&kind=customer.payment&customer_id=" +
                  encodeURIComponent(id)
                }
              >
                Проверить события оплаты
              </Link>
              <Link to={"/reconcile?customer=" + encodeURIComponent(id)}>
                Проверить состояние клиента
              </Link>
            </div>
            {role !== "viewer" && (
              <details>
                <summary>Управление блокировкой повтора</summary>
                <p>
                  Снимайте блокировку после проверки журнала и состояния
                  клиента. Эта отметка сохраняет ваше решение в текущей вкладке.
                </p>
                <button type="button" onClick={() => updateCheck(id)}>
                  Проверку завершил · снять блокировку
                </button>
              </details>
            )}
          </div>
        ))}
      {change.isPending && change.variables?.payment && (
        <p role="status" className="notice">
          Ожидаем подтверждение Billing.
        </p>
      )}
      {role !== "viewer" && (
        <Panel title={edit ? "Изменить профиль" : "Новый клиент"}>
          <form
            key={edit?.id ?? change.data?.event_id ?? "new"}
            className="filters"
            onSubmit={submit}
          >
            <label>
              Наименование
              <input
                name="name"
                required
                maxLength={120}
                defaultValue={edit?.name}
              />
            </label>
            <label>
              Контактный email
              <input
                name="email"
                type="email"
                maxLength={160}
                defaultValue={edit?.email ?? ""}
              />
            </label>
            <button className="primary" disabled={change.isPending}>
              {edit ? "Сохранить профиль" : "Создать клиента"}
            </button>
            {edit && (
              <button type="button" onClick={() => setEdit(null)}>
                Отмена
              </button>
            )}
          </form>
        </Panel>
      )}
      <Panel title="Профили CRM">
        {data.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th>Версия</th>
                  <th>Оплата</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      <small className="mono">{c.id}</small>
                    </td>
                    <td>v{c.version}</td>
                    <td>{c.payment_status ?? "—"}</td>
                    <td className="actions">
                      <Link to={"/reconcile?customer=" + c.id}>Сверить</Link>
                      {role !== "viewer" && (
                        <>
                          <button onClick={() => setEdit(c)}>Изменить</button>
                          <button
                            disabled={change.isPending || Boolean(checks[c.id])}
                            onClick={() => {
                              if (currentChecks.current[c.id]) return;
                              updateCheck(
                                c.id,
                                "Команда ожидала подтверждения",
                              );
                              change.mutate({
                                path: `/customers/${c.id}/payment`,
                                method: "POST",
                                body: { status: "PAID" },
                                payment: c.id,
                              });
                            }}
                          >
                            Оплатить
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty pending={data.isPending} />
        )}
      </Panel>
    </>
  );
}
export function Reconcile() {
  const { role } = useOutletContext<Viewer>();
  const [input, setInput] = useState(
    () => new URLSearchParams(location.search).get("customer") ?? "",
  );
  const [customer, setCustomer] = useState(
    () => new URLSearchParams(location.search).get("customer") ?? "",
  );
  const data = useQuery({
    queryKey: ["reconciliation", customer],
    queryFn: () =>
      api<Reconciliation>("/reconciliation/" + encodeURIComponent(customer)),
    enabled: Boolean(customer),
  });
  const repair = useMutation({
    mutationFn: () =>
      api<Publication>(
        "/reconciliation/" + encodeURIComponent(customer) + "/repair",
        "POST",
      ),
  });
  return (
    <>
      <Heading
        title="Сверка данных"
        subtitle="Снимки CRM, ERP и Billing, полученные через сетевые контракты"
      />
      <Panel title="Запрос сверки">
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            repair.reset();
            const id = input.trim();
            if (id === customer) void data.refetch();
            else setCustomer(id);
          }}
        >
          <label>
            Глобальный ID клиента
            <input
              required
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="UUID"
            />
          </label>
          <button className="primary">Выполнить сверку</button>
        </form>
      </Panel>
      <ErrorBox error={data.error ?? repair.error} />
      {customer && data.isPending && <Empty pending />}
      {data.data && (
        <>
          <Panel
            title="Расхождения"
            action={
              <Badge status={data.data.issues.length ? "RETRY" : "SUCCEEDED"} />
            }
          >
            {data.data.issues.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Система</th>
                      <th>Причина</th>
                      <th>Поле</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.issues.map((i, index) => (
                      <tr key={index}>
                        <td>{i.target}</td>
                        <td title={i.code}>
                          {{
                            UNAVAILABLE: "Сервис недоступен",
                            MISSING: "Проекция отсутствует",
                            VERSION_LAG: "Версия отстаёт",
                            VALUE_MISMATCH: "Значение отличается",
                          }[i.code] ?? i.code}{" "}
                          · <code>{i.code}</code>
                        </td>
                        <td>{i.field ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Расхождений нет.</Empty>
            )}
            {role !== "viewer" &&
              data.data.records.CRM &&
              data.data.issues.some(
                (i) =>
                  ["ERP", "Billing"].includes(i.target) &&
                  ["MISSING", "VERSION_LAG"].includes(i.code),
              ) && (
                <div className="panel-body">
                  <button
                    disabled={repair.isPending}
                    onClick={() => repair.mutate()}
                  >
                    Переотправить профиль CRM
                  </button>
                </div>
              )}
          </Panel>
          <Panel title="Записи источников">
            <dl className="meta">
              {Object.entries(data.data.records).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>
                    {value
                      ? "v" + value.version
                      : data.data.issues.some(
                            (i) =>
                              i.target === name && i.code === "UNAVAILABLE",
                          )
                        ? "Недоступен"
                        : "Запись отсутствует"}
                  </dd>
                </div>
              ))}
            </dl>
            {Object.entries(data.data.records).map(([name, value]) => (
              <details key={name}>
                <summary>{name}</summary>
                <Json value={value} />
              </details>
            ))}
          </Panel>
        </>
      )}
      {repair.data && (
        <p className="notice" role="status">
          Опубликована актуальная версия профиля.{" "}
          <Link
            to={"/messages/" + repair.data.event_id}
            state={{ publication: repair.data.event_id }}
          >
            Отследить доставку
          </Link>
        </p>
      )}
    </>
  );
}

export function Lab() {
  const [event, setEvent] = useState("");
  const [availability, setAvailability] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const queue = useQuery({
    queryKey: ["broker"],
    queryFn: () => api<Broker>("/broker"),
    refetchInterval: 2000,
  });
  const dlq = useQuery({
    queryKey: ["lab-dlq"],
    queryFn: () => api<Issue[]>("/errors?dead_only=true"),
    refetchInterval: 2000,
  });
  const action = useMutation({
    mutationFn: ({
      path,
      method,
      body,
    }: {
      path: string;
      method: string;
      body: unknown;
    }) => api<Record<string, unknown>>(path, method, body),
    onSuccess: (result, variables) => {
      if (typeof result.event_id === "string") setEvent(result.event_id);
      if (variables.path.startsWith("/lab/availability/")) {
        const target = variables.path.split("/").at(-1)!;
        setAvailability((previous) => ({
          ...previous,
          [target]: (variables.body as { unavailable: boolean }).unavailable
            ? "Недоступность включена"
            : "Недоступность отключена",
        }));
      }
      void qc.invalidateQueries({ queryKey: ["broker"] });
      void qc.invalidateQueries({ queryKey: ["lab-dlq"] });
    },
  });
  function send(path: string, method: string, body: unknown) {
    action.mutate({ path, method, body });
  }
  return (
    <>
      <Heading
        title="Лаборатория надёжности"
        subtitle="Фиксированные эксперименты на отдельном стенде PostgreSQL и RabbitMQ"
      />
      <div className="cols">
        <Panel title="Сбой получателя">
          <div className="panel-body stack">
            <p className="muted">
              Выключение моделирует недоступность целевого API. Доставки другим
              получателям продолжаются.
            </p>
            {["ERP", "Billing"].map((target) => (
              <div key={target} className="actions">
                <strong>{target}</strong>
                {availability[target] && (
                  <small role="status">
                    Последняя команда · {availability[target]}
                  </small>
                )}
                <button
                  disabled={action.isPending}
                  onClick={() =>
                    send("/lab/availability/" + target, "PUT", {
                      unavailable: true,
                    })
                  }
                >
                  Выключить {target}
                </button>
                <button
                  disabled={action.isPending}
                  onClick={() =>
                    send("/lab/availability/" + target, "PUT", {
                      unavailable: false,
                    })
                  }
                >
                  Включить {target}
                </button>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Транспорт">
          <dl className="meta">
            <div>
              <dt>RabbitMQ</dt>
              <dd>{queue.data?.available ? "Доступен" : "—"}</dd>
            </div>
            <div>
              <dt>Готово</dt>
              <dd>{queue.data?.ready ?? "—"}</dd>
            </div>
            <div>
              <dt>Без подтверждения</dt>
              <dd>{queue.data?.unacked ?? "—"}</dd>
            </div>
          </dl>
          <div className="panel-body">
            <Link to="/dlq">Открыть карантин и восстановление</Link>
          </div>
        </Panel>
      </div>
      <Panel title="Публикация событий">
        <div className="panel-body stack">
          <label>
            Event ID
            <small>
              Дубликат использует тот же Event ID. Для устаревшей версии
              выберите событие v2 или выше.
            </small>
            <input
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              placeholder="UUID принятого события"
            />
          </label>
          <div className="actions">
            <button
              className="primary"
              disabled={action.isPending}
              onClick={() =>
                send("/customers", "POST", {
                  name: "Контур лаборатории",
                  email: "lab@example.test",
                })
              }
            >
              Создать учебного клиента
            </button>
            <button
              disabled={!event || action.isPending}
              onClick={() =>
                send("/lab/publish/duplicate", "POST", { event_id: event })
              }
            >
              Отправить дубликат
            </button>
            <button
              disabled={!event || action.isPending}
              onClick={() =>
                send("/lab/publish/stale", "POST", { event_id: event })
              }
            >
              Отправить устаревшую версию
            </button>
            <button
              disabled={action.isPending}
              onClick={() => send("/lab/publish/invalid", "POST", {})}
            >
              Отправить неверный контракт
            </button>
          </div>
          {event && (
            <Link
              to={"/messages/" + encodeURIComponent(event)}
              state={
                action.data?.event_id === event
                  ? { publication: event }
                  : undefined
              }
            >
              Отследить сообщение {short(event)}
            </Link>
          )}
        </div>
        <ErrorBox error={action.error} />
        {action.data?.published === "duplicate" && (
          <p role="status" className="notice">
            Повторная публикация подтверждена с тем же Event ID. Число доставок
            и попыток можно сверить в трассировке.
          </p>
        )}
        {action.data?.published === "invalid" && (
          <p role="status" className="notice">
            Публикация подтверждена. После проверки контракта запись появится во
            входном карантине. <Link to="/dlq">Открыть карантин</Link>
          </p>
        )}
        {action.data && (
          <details open>
            <summary>Ответ API</summary>
            <Json value={action.data} />
          </details>
        )}
      </Panel>
      <Panel title="Последние записи DLQ">
        {dlq.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Событие</th>
                  <th>Состояние</th>
                  <th>Код</th>
                </tr>
              </thead>
              <tbody>
                {dlq.data.slice(0, 5).map((e) => (
                  <tr key={e.event_id + (e.delivery_id ?? "")}>
                    <td>
                      <Link to={"/messages/" + e.event_id}>
                        {short(e.event_id)}
                      </Link>
                    </td>
                    <td>
                      <Badge status={e.status} />
                    </td>
                    <td className="mono">{e.code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty pending={dlq.isPending} />
        )}
      </Panel>
    </>
  );
}
