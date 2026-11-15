let token = "";
export function session(value: string) {
  token = value;
}
export type Viewer = { role: "admin" | "operator" | "viewer"; lab: boolean };
export type EventRow = {
  id: string;
  correlation_id: string | null;
  customer_id: string | null;
  source: string | null;
  type: string | null;
  version: number | null;
  received_at: string;
  rejection: string | null;
  succeeded: number;
  total: number;
  deliveries?: DeliverySummary[];
};
export type Attempt = {
  id: number;
  generation: number;
  number: number;
  started_at: string;
  duration_ms: number;
  http_status: number | null;
  outcome: string;
};
export type DeliverySummary = {
  id: string;
  target: string;
  status: string;
  outcome: string | null;
  next_at: string;
  generation: number;
  last_attempt_at?: string | null;
};
export type Delivery = DeliverySummary & {
  transformation: Record<string, unknown>;
  attempts: Attempt[];
  replays?: { created_at: string }[];
};
export type Detail = {
  event: EventRow & { payload: unknown };
  deliveries: Delivery[];
  related: EventRow[];
};
export type System = {
  name: string;
  protocol: string;
  endpoint: string;
  reachable: boolean;
  contract: string;
};
export type Route = {
  event: string;
  source: string;
  version: number;
  targets: string[];
};
export type Issue = {
  event_id: string;
  delivery_id: string | null;
  target: string | null;
  code: string;
  status: string;
  received_at: string;
};
export type Customer = {
  id: string;
  local_id: string;
  name: string;
  email: string | null;
  version: number;
  payment_status: string | null;
  payment_version: number;
};
export type Publication = {
  record: Customer;
  event_id: string;
  correlation_id: string;
};
export type Reconciliation = {
  customer_id: string;
  records: Record<string, Customer | null>;
  issues: { target: string; code: string; field?: string }[];
};
export type Stats = {
  events: number;
  rejected: number;
  mean_ms: number | null;
  p95_ms: number | null;
  states: { target: string; status: string; count: number }[];
};
export type Broker = {
  available: boolean;
  ready: number | null;
  unacked: number | null;
};
const errors: Record<string, string> = {
  LOGIN_REQUIRED: "Введите действительный ключ доступа.",
  ROLE_FORBIDDEN: "Для операции требуется роль оператора.",
  LAB_FORBIDDEN: "Лаборатория доступна администратору отдельного стенда.",
  DELIVERY_NOT_DEAD: "Доставка уже восстановлена или ещё обрабатывается.",
  USE_VERSION_2_OR_HIGHER: "Выберите событие версии 2 или выше.",
  SOURCE_UNAVAILABLE: "Источник временно недоступен.",
  BROKER_UNAVAILABLE: "RabbitMQ временно недоступен.",
  MESSAGE_MISSING: "Событие ещё не получено или отсутствует.",
  NO_REPAIRABLE_DRIFT:
    "Повторите сверку: расхождение уже устранено или требует ручного разбора.",
  AUTHORITATIVE_PROFILE_UNAVAILABLE:
    "Профиль CRM недоступен для восстановления.",
  VERSION_CONFLICT: "Конфликт данных одной версии.",
};
export class ApiError extends Error {
  constructor(
    public status: number | null,
    public code: string | null,
    message: string,
  ) {
    super(message);
  }

  get uncertain() {
    return this.status === null || this.status === 408 || this.status >= 500;
  }
}

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      method,
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: "Bearer " + token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError";
    throw new ApiError(
      null,
      null,
      timedOut
        ? "Истекло время ожидания ответа."
        : "Связь с сервером прервана.",
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof payload?.detail === "string" ? payload.detail : null;
    throw new ApiError(
      response.status,
      code,
      (code ? errors[code] : undefined) ??
        (response.status === 422
          ? "Проверьте формат введённых данных."
          : `Запрос завершился с HTTP ${response.status}.`),
    );
  }
  if (payload === null)
    throw new ApiError(null, null, "Ответ сервера не удалось прочитать.");
  return payload;
}
export const stamp = (time: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(new Date(time)) + " UTC";
export const short = (id: string | null) => id?.slice(0, 8) ?? "—";

export const timelineStamp = (time: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(time)) + " UTC";
