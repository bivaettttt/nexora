import type { DeliverySummary } from "./api";

export const protocol: Record<string, string> = {
  ERP: "SOAP 1.1",
  Billing: "REST",
  CRM: "REST",
};

export const outcomes: Record<string, string> = {
  APPLIED: "Применено",
  SAME: "Эта версия уже применена",
  STALE: "Устаревшая версия пропущена",
  UNAVAILABLE: "Получатель временно недоступен",
  TIMEOUT: "Истекло время ожидания получателя",
  NETWORK: "Связь с получателем прервана",
  CONTRACT: "Нарушение интеграционного контракта",
  INVALID_CONTRACT: "Входное событие отклонено при проверке контракта",
  INVALID_JSON: "Входное событие не удалось разобрать",
  AUTHORIZATION: "Получатель отклонил авторизацию",
  BUSINESS_REJECTION: "Получатель отклонил операцию",
  EVENT_ID_CONFLICT: "Этот Event ID уже зарегистрирован с другим содержимым",
};

export function intent(
  deliveries: DeliverySummary[],
  rejection?: string | null,
) {
  if (rejection) return { tone: "bad", text: "Входной карантин" };
  if (!deliveries.length) return { tone: "neutral", text: "Доставок пока нет" };
  const successful = deliveries.filter((d) => d.status === "SUCCEEDED");
  if (successful.length === deliveries.length) {
    if (deliveries.some((d) => d.generation > 0))
      return { tone: "good", text: "Доставка восстановлена" };
    return { tone: "good", text: "Все доставки завершены" };
  }
  const terminal = deliveries.some((d) => d.status === "DEAD");
  const retry = deliveries.some((d) => d.status === "RETRY");
  const next = terminal
    ? "есть доставка в DLQ"
    : retry
      ? "ожидается повтор"
      : "обработка продолжается";
  if (successful.length)
    return { tone: "wait", text: "Частичный результат · " + next };
  return {
    tone: terminal ? "bad" : "wait",
    text: next[0].toUpperCase() + next.slice(1),
  };
}

export function messageLink(
  id: string,
  delivery?: string | null,
  search?: string,
  back?: string,
) {
  const params = new URLSearchParams();
  if (delivery) params.set("delivery", delivery);
  if (search) params.set("registry", search);
  if (back) params.set("from", back);
  return "/messages/" + id + (params.size ? "?" + params : "");
}
