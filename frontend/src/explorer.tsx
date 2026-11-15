import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type EventRow } from "./api";
import { ErrorBox, Events, Heading, Panel } from "./ui";

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const modes = [
  ["event_id", "Event ID"],
  ["correlation_id", "Correlation ID"],
  ["delivery_id", "Delivery ID"],
  ["customer_id", "ID клиента"],
];
const facets = [
  ["source", "Источник", ["CRM", "Billing"]],
  ["target", "Получатель", ["CRM", "ERP", "Billing"]],
  ["kind", "Тип события", ["customer.profile", "customer.payment"]],
  ["status", "Состояние доставки", ["PENDING", "RETRY", "SUCCEEDED", "DEAD"]],
] as const;
const stateLabels: Record<string, string> = {
  PENDING: "В очереди",
  RETRY: "Ожидает повтора",
  SUCCEEDED: "Доставлено",
  DEAD: "В DLQ",
};

function FilterForm({
  params,
  apply,
}: {
  params: URLSearchParams;
  apply: (next: URLSearchParams) => void;
}) {
  const initial = modes.find(([key]) => params.has(key))?.[0] ?? "event_id";
  const [mode, setMode] = useState(initial);
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = String(form.get("identity")).trim();
    if (id && !uuid.test(id)) {
      setError(
        "Введите полный UUID, например 50c096b7-6ed7-4443-8ec7-b82696a4cc86.",
      );
      event.currentTarget.querySelector<HTMLInputElement>("#identity")?.focus();
      return;
    }
    const next = new URLSearchParams();
    if (id) next.set(mode, id);
    for (const key of [
      "source",
      "target",
      "kind",
      "status",
      "since",
      "order",
    ]) {
      const value = String(form.get(key) ?? "");
      if (value && value !== "newest") next.set(key, value);
    }
    apply(next);
  }
  return (
    <form className="explorer-filter" onSubmit={submit}>
      <div className="search-row">
        <label>
          Идентификатор
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {modes.map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="search-input">
          {modes.find(([key]) => key === mode)?.[1]}
          <input
            id="identity"
            name="identity"
            defaultValue={params.get(initial) ?? ""}
            placeholder="Введите UUID"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "identity-error" : undefined}
            onChange={() => setError("")}
            spellCheck={false}
          />
        </label>
        <button className="primary">Найти</button>
        <Link className="secondary" to="/messages">
          Сбросить
        </Link>
      </div>
      {error && (
        <p className="field-error" id="identity-error" role="alert">
          {error}
        </p>
      )}
      <details
        className="filter-options"
        open={
          ["source", "target", "kind", "status", "since", "order"].some((key) =>
            params.has(key),
          ) || undefined
        }
      >
        <summary>Дополнительные фильтры и сортировка</summary>
        <div className="filters">
          {facets.map(([key, label, options]) => (
            <label key={key}>
              {label}
              <select name={key} defaultValue={params.get(key) ?? ""}>
                <option value="">Все</option>
                {options.map((value) => (
                  <option key={value} value={value}>
                    {stateLabels[value] ?? value}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            Получено после (местное время)
            <input
              name="since"
              type="datetime-local"
              defaultValue={params.get("since") ?? ""}
            />
          </label>
          <label>
            Порядок
            <select name="order" defaultValue={params.get("order") ?? "newest"}>
              <option value="newest">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
            </select>
          </label>
        </div>
      </details>
    </form>
  );
}

export function Explorer() {
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const offsetValue = Number(params.get("offset"));
  const offset =
    Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
  const request = new URLSearchParams({
    include_deliveries: "true",
    offset: String(offset),
  });
  for (const key of [
    ...modes.map(([key]) => key),
    "source",
    "target",
    "kind",
    "status",
    "order",
  ]) {
    const value = params.get(key);
    if (value) request.set(key, value);
  }
  const since = params.get("since");
  if (since && Number.isFinite(Date.parse(since)))
    request.set("since", new Date(since).toISOString());
  const data = useQuery({
    queryKey: ["events", request.toString()],
    queryFn: () => api<EventRow[]>("/messages?" + request),
    refetchInterval: 4000,
  });
  function go(delta: number) {
    const next = new URLSearchParams(params);
    if (offset + delta > 0) next.set("offset", String(offset + delta));
    else next.delete("offset");
    setParams(next);
  }
  return (
    <>
      <Heading
        title="Журнал сообщений"
        subtitle="Поиск событий и независимых доставок"
      />
      <Panel title="Поиск">
        <FilterForm key={search} params={params} apply={setParams} />
      </Panel>
      <ErrorBox error={data.error} />
      <Panel
        title="События"
        action={
          data.data && (
            <span className="muted" role="status">
              На странице {data.data.length}
            </span>
          )
        }
      >
        <Events
          data={data.data}
          pending={data.isPending}
          search={search}
          empty={
            data.error
              ? "Журнал временно недоступен."
              : "Событий по этим условиям нет."
          }
        />
        <div className="pager" aria-label="Пагинация">
          <button disabled={!offset} onClick={() => go(-50)}>
            Назад
          </button>
          <span>Страница {Math.floor(offset / 50) + 1}</span>
          <button
            disabled={(data.data?.length ?? 0) < 50}
            onClick={() => go(50)}
          >
            Далее
          </button>
        </div>
      </Panel>
    </>
  );
}
