import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";
import { useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useOutletContext,
  useParams,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Boxes,
  Cable,
  FlaskConical,
  GitBranch,
  History,
  LayoutDashboard,
  List,
  LogOut,
  Network,
  Search,
  ShieldAlert,
  Split,
  Waypoints,
} from "lucide-react";
import {
  api,
  session,
  short,
  stamp,
  type Broker,
  type Detail,
  type EventRow,
  type Issue,
  type Route as RouteModel,
  type Stats,
  type System,
  type Viewer,
} from "./api";
import { Badge, Empty, ErrorBox, Events, Heading, Json, Panel } from "./ui";
import { Customers, Lab, Reconcile } from "./workflows";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const polling = { refetchInterval: 2000 };
const navigation = [
  ["/", "Сводка", LayoutDashboard],
  ["/systems", "Системы", Boxes],
  ["/routes", "Маршруты", GitBranch],
  ["/messages", "Сообщения", List],
  ["/errors", "Ошибки", Activity],
  ["/dlq", "Очередь DLQ", ShieldAlert],
  ["/mapping", "Маппинг", Split],
  ["/reconcile", "Сверка", Search],
  ["/customers", "Клиенты CRM", Network],
  ["/docs", "Контракты", BookOpen],
] as const;
const useViewer = () => useOutletContext<Viewer>();
function Brand() {
  return (
    <div className="brand">
      <span>
        <Waypoints size={23} />
      </span>
      <strong>Nexora</strong>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (user: Viewer) => void }) {
  const [key, setKey] = useState("");
  const login = useMutation({
    mutationFn: async () => {
      session(key);
      try {
        return await api<Viewer>("/me");
      } catch (error) {
        session("");
        throw error;
      }
    },
    onSuccess: onLogin,
  });
  return (
    <div className="login">
      <div className="login-card">
        <Brand />
        <h1>Вход в Nexora</h1>
        <p>Рабочее пространство интеграций</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <label>
            Ключ доступа
            <input
              type="password"
              required
              autoComplete="current-password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <ErrorBox error={login.error} />
          <button className="primary" disabled={login.isPending}>
            Войти <ArrowRight size={17} />
          </button>
        </form>
      </div>
    </div>
  );
}
function Shell() {
  const [user, setUser] = useState<Viewer | null>(null);
  const qc = useQueryClient();
  if (!user) return <Login onLogin={setUser} />;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <div className="side-label">INTEGRATION CONTROL CENTER</div>
        <nav aria-label="Разделы консоли">
          {navigation.map(([path, label, Icon]) => (
            <NavLink to={path} end={path === "/"} key={path}>
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
          {user.lab && (
            <NavLink to="/lab">
              <FlaskConical size={17} />
              Лаборатория
            </NavLink>
          )}
        </nav>
        <div className="side-foot">
          <i />
          {user.lab ? "Изолированный стенд" : "Учебный стенд"}
        </div>
      </aside>
      <div className="workspace">
        <div className="topbar">
          <span>
            <Cable size={16} /> Nexora <span className="slash">/</span>{" "}
            Операционная консоль
          </span>
          <div>
            <span className="role">{user.role}</span>
            <button
              className="icon"
              aria-label="Выйти"
              onClick={() => {
                session("");
                qc.clear();
                setUser(null);
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
        <main>
          <Outlet context={user} />
        </main>
      </div>
    </div>
  );
}
function Dashboard() {
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: () => api<Stats>("/stats"),
    ...polling,
  });
  const messages = useQuery({
    queryKey: ["recent"],
    queryFn: () => api<EventRow[]>("/messages"),
    ...polling,
  });
  const broker = useQuery({
    queryKey: ["broker"],
    queryFn: () => api<Broker>("/broker"),
    ...polling,
  });
  const systems = useQuery({
    queryKey: ["systems"],
    queryFn: () => api<System[]>("/systems"),
    refetchInterval: 5000,
  });
  const d = stats.data;
  const failed = d?.states
    .filter((s) => s.status === "DEAD")
    .reduce((sum, s) => sum + s.count, 0);
  return (
    <>
      <Heading
        title="Сводка обмена"
        subtitle="Состояние транспортной очереди и доставок по получателям"
      >
        <Link className="primary" to="/customers">
          Клиенты CRM <ArrowRight size={16} />
        </Link>
      </Heading>
      <ErrorBox
        error={stats.error ?? messages.error ?? broker.error ?? systems.error}
      />
      <div className="metrics">
        {[
          ["Принято событий", d?.events],
          ["Изолировано", d && d.rejected + (failed ?? 0)],
          ["RabbitMQ · готово", broker.data?.ready],
          ["Попытка · p95", d?.p95_ms == null ? null : d.p95_ms + " мс"],
          ["Попытка · среднее", d?.mean_ms == null ? null : d.mean_ms + " мс"],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value ?? "—"}</strong>
          </div>
        ))}
      </div>
      <div className="cols">
        <Panel title="Участники обмена">
          <div className="system-list">
            {systems.data?.map((s) => (
              <div key={s.name}>
                <span>
                  <Boxes size={17} />
                  <strong>{s.name}</strong>
                  <small>{s.protocol}</small>
                </span>
                <Badge status={s.reachable ? "UP" : "DOWN"} />
              </div>
            )) ?? <Empty pending={systems.isPending} />}
          </div>
        </Panel>
        <Panel title="Статусы доставок">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Получатель</th>
                  <th>Состояние</th>
                  <th>Число</th>
                </tr>
              </thead>
              <tbody>
                {d?.states.map((s) => (
                  <tr key={s.target + s.status}>
                    <td>{s.target}</td>
                    <td>
                      <Badge status={s.status} />
                    </td>
                    <td>{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d?.states.length === 0 && <Empty />}
        </Panel>
      </div>
      <Panel
        title="Последние события"
        action={
          <Link to="/messages">
            Открыть журнал <ArrowRight size={15} />
          </Link>
        }
      >
        <Events
          data={messages.data?.slice(0, 7)}
          pending={messages.isPending}
        />
      </Panel>
    </>
  );
}
function Systems() {
  const data = useQuery({
    queryKey: ["systems"],
    queryFn: () => api<System[]>("/systems"),
    refetchInterval: 5000,
  });
  return (
    <>
      <Heading
        title="Реестр систем"
        subtitle="Сетевые интерфейсы и результаты проверки доступности"
      />
      <ErrorBox error={data.error} />
      <Panel title="Участники">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Система</th>
                <th>Протокол</th>
                <th>Endpoint</th>
                <th>Контракт</th>
                <th>Проверка</th>
              </tr>
            </thead>
            <tbody>
              {data.data?.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>{s.protocol}</td>
                  <td className="mono">{s.endpoint}</td>
                  <td>
                    <a href={"/contracts/" + s.contract}>{s.contract}</a>
                  </td>
                  <td>
                    <Badge status={s.reachable ? "UP" : "DOWN"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.isPending && <Empty pending />}
      </Panel>
    </>
  );
}
function RoutesPage({ mapping = false }: { mapping?: boolean }) {
  const data = useQuery({
    queryKey: ["routes"],
    queryFn: () => api<RouteModel[]>("/routes"),
  });
  const fields = [
    [
      "CRM → ERP",
      "customer_id, version, data.name",
      "GlobalId, Version, LegalName",
    ],
    ["CRM → Billing", "data.name, data.email, version", "name, email, version"],
    ["Billing → CRM", "data.status, version", "status, version"],
  ];
  return (
    <>
      <Heading
        title={mapping ? "Инспектор маппинга" : "Маршруты интеграции"}
        subtitle={
          mapping
            ? "Преобразования канонического события в контракты получателей"
            : "Действующие маршруты версии 1"
        }
      />
      <ErrorBox error={data.error} />
      <Panel title={mapping ? "Поля получателей" : "Реестр маршрутов"}>
        <div className="table-wrap">
          <table>
            {mapping ? (
              <>
                <thead>
                  <tr>
                    <th>Маршрут</th>
                    <th>Входные поля</th>
                    <th>Поля получателя</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map(([route, source, target]) => (
                    <tr key={route}>
                      <td>{route}</td>
                      <td className="mono">{source}</td>
                      <td className="mono">{target}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                <thead>
                  <tr>
                    <th>Событие</th>
                    <th>Источник</th>
                    <th>Контракт</th>
                    <th>Получатели</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data?.map((r) => (
                    <tr key={r.event}>
                      <td className="mono">{r.event}</td>
                      <td>{r.source}</td>
                      <td>v{r.version}</td>
                      <td>{r.targets.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
        {data.isPending && !mapping && <Empty pending />}
      </Panel>
      {mapping && (
        <p className="muted">
          Фактическое преобразование конкретного события доступно в деталях
          каждой доставки.
        </p>
      )}
    </>
  );
}
function Explorer() {
  const [filters, setFilters] = useState("");
  const [offset, setOffset] = useState(0);
  const data = useQuery({
    queryKey: ["messages", filters, offset],
    queryFn: () => api<EventRow[]>(`/messages?${filters}&offset=${offset}`),
    ...polling,
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(e.currentTarget)) {
      const raw = String(value).trim();
      if (raw)
        params.set(key, key === "since" ? new Date(raw).toISOString() : raw);
    }
    setFilters(params.toString());
    setOffset(0);
  }
  return (
    <>
      <Heading
        title="Журнал сообщений"
        subtitle="Поиск по маршруту, времени, идентификаторам и статусу доставки"
      />
      <Panel title="Фильтры">
        <form className="filters" onSubmit={submit}>
          <label>
            Event ID
            <input name="event_id" placeholder="UUID" />
          </label>
          <label>
            Correlation ID
            <input name="correlation_id" placeholder="UUID" />
          </label>
          <label>
            Тип
            <select name="kind">
              <option value="">Все</option>
              <option>customer.profile</option>
              <option>customer.payment</option>
            </select>
          </label>
          <label>
            Источник
            <select name="source">
              <option value="">Все</option>
              <option>CRM</option>
              <option>Billing</option>
            </select>
          </label>
          <label>
            Получатель
            <select name="target">
              <option value="">Все</option>
              <option>CRM</option>
              <option>ERP</option>
              <option>Billing</option>
            </select>
          </label>
          <label>
            Статус
            <select name="status">
              <option value="">Все</option>
              <option>PENDING</option>
              <option>RETRY</option>
              <option>SUCCEEDED</option>
              <option>DEAD</option>
            </select>
          </label>
          <label>
            Получено после
            <input name="since" type="datetime-local" />
          </label>
          <button className="primary">Найти</button>
        </form>
      </Panel>
      <ErrorBox error={data.error} />
      <Panel title="События">
        <Events data={data.data} pending={data.isPending} />
        <div className="pager">
          <button disabled={!offset} onClick={() => setOffset(offset - 50)}>
            Назад
          </button>
          <span>{offset / 50 + 1}</span>
          <button
            disabled={(data.data?.length ?? 0) < 50}
            onClick={() => setOffset(offset + 50)}
          >
            Далее
          </button>
        </div>
      </Panel>
    </>
  );
}
function Message() {
  const { id } = useParams();
  const user = useViewer();
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: ["message", id],
    queryFn: () => api<Detail>("/messages/" + id),
    ...polling,
  });
  const replay = useMutation({
    mutationFn: (delivery: string) =>
      api("/deliveries/" + delivery + "/replay", "POST"),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (data.isPending) return <Empty pending />;
  if (data.error) return <ErrorBox error={data.error} />;
  const { event, deliveries, related } = data.data;
  return (
    <>
      <Link to="/messages">← Журнал сообщений</Link>
      <Heading title={event.type ?? "Событие в карантине"} subtitle={event.id}>
        {event.rejection && <Badge status="QUARANTINED" />}
      </Heading>
      <Panel title="Событие">
        <dl className="meta">
          <div>
            <dt>Correlation ID</dt>
            <dd className="mono">{event.correlation_id ?? "—"}</dd>
          </div>
          <div>
            <dt>Клиент</dt>
            <dd className="mono">{event.customer_id ?? "—"}</dd>
          </div>
          <div>
            <dt>Получено</dt>
            <dd>{stamp(event.received_at)}</dd>
          </div>
          <div>
            <dt>Контракт / версия</dt>
            <dd>{event.version ? "v1 / " + event.version : event.rejection}</dd>
          </div>
        </dl>
        <details>
          <summary>Полезная нагрузка</summary>
          <Json value={event.payload} />
        </details>
      </Panel>
      <ErrorBox error={replay.error} />
      {replay.isSuccess && (
        <p role="status" className="notice">
          Повтор поставлен в очередь.
        </p>
      )}
      {deliveries.map((d) => (
        <Panel
          key={d.id}
          title={"Доставка · " + d.target}
          action={<Badge status={d.status} />}
        >
          <dl className="meta">
            <div>
              <dt>Delivery ID</dt>
              <dd className="mono">{d.id}</dd>
            </div>
            <div>
              <dt>Результат</dt>
              <dd>{d.outcome ?? "—"}</dd>
            </div>
            {d.status === "RETRY" && (
              <div>
                <dt>Следующая попытка</dt>
                <dd>{stamp(d.next_at)}</dd>
              </div>
            )}
          </dl>
          <details>
            <summary>Преобразование и поля назначения</summary>
            <Json value={d.transformation} />
          </details>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Серия / попытка</th>
                  <th>Время</th>
                  <th>Длительность</th>
                  <th>HTTP</th>
                  <th>Результат</th>
                </tr>
              </thead>
              <tbody>
                {d.attempts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.generation + 1} / {a.number}
                    </td>
                    <td>{stamp(a.started_at)}</td>
                    <td>{a.duration_ms} мс</td>
                    <td>{a.http_status ?? "—"}</td>
                    <td className="mono">{a.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!d.attempts.length && <Empty>Ожидание первой попытки.</Empty>}
          {d.status === "DEAD" && user.role !== "viewer" && (
            <div className="panel-body">
              <button
                disabled={replay.isPending}
                onClick={() => replay.mutate(d.id)}
              >
                Повторить доставку
              </button>
            </div>
          )}
        </Panel>
      ))}
      <Panel title="Связанные события">
        {related.length ? (
          <ul className="related">
            {related.map((item) => (
              <li key={item.id}>
                <Link to={"/messages/" + item.id}>
                  <History size={15} />
                  {item.type ?? "Событие"} · {short(item.id)}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Panel>
    </>
  );
}
function Errors({ dead = false }: { dead?: boolean }) {
  const [offset, setOffset] = useState(0);
  const data = useQuery({
    queryKey: ["errors", dead, offset],
    queryFn: () => api<Issue[]>(`/errors?dead_only=${dead}&offset=${offset}`),
    ...polling,
  });
  return (
    <>
      <Heading
        title={dead ? "Очередь DLQ" : "Мониторинг ошибок"}
        subtitle={
          dead
            ? "Устойчивый реестр отклонённых событий и исчерпанных доставок"
            : "Активные повторы, отказавшие доставки и ошибки контракта"
        }
      />
      <ErrorBox error={data.error} />
      <Panel
        title={dead ? "Карантин и исчерпанные доставки" : "Ошибки обработки"}
      >
        {data.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Сообщение</th>
                  <th>Цель</th>
                  <th>Причина</th>
                  <th>Состояние</th>
                  <th>Получено</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((e) => (
                  <tr key={e.event_id + (e.delivery_id ?? "")}>
                    <td>
                      <Link to={"/messages/" + e.event_id}>
                        {short(e.event_id)}
                      </Link>
                    </td>
                    <td>{e.target ?? "Inbox"}</td>
                    <td className="mono">{e.code}</td>
                    <td>
                      <Badge status={e.status} />
                    </td>
                    <td>{stamp(e.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty pending={data.isPending}>Ошибок на этой странице нет.</Empty>
        )}
        <div className="pager">
          <button disabled={!offset} onClick={() => setOffset(offset - 50)}>
            Назад
          </button>
          <span>{offset / 50 + 1}</span>
          <button
            disabled={(data.data?.length ?? 0) < 50}
            onClick={() => setOffset(offset + 50)}
          >
            Далее
          </button>
        </div>
      </Panel>
    </>
  );
}
function Docs() {
  return (
    <>
      <Heading
        title="Контракты интеграций"
        subtitle="Машиночитаемые спецификации и документация"
      />
      <Panel title="Контракты">
        <ul className="related">
          {[
            ["nexora.openapi.json", "Nexora · OpenAPI"],
            ["crm.openapi.json", "CRM · OpenAPI"],
            ["billing.openapi.json", "Billing · OpenAPI"],
            ["partner.wsdl", "ERP · WSDL"],
            ["partner.xsd", "ERP · XSD"],
            ["asyncapi.yaml", "RabbitMQ · AsyncAPI"],
          ].map(([file, label]) => (
            <li key={file}>
              <a href={"/contracts/" + file}>
                {label}
                <ArrowRight size={15} />
              </a>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
function LabPage() {
  const user = useViewer();
  return user.lab ? <Lab /> : <Navigate replace to="/" />;
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="systems" element={<Systems />} />
          <Route path="routes" element={<RoutesPage />} />
          <Route path="mapping" element={<RoutesPage mapping />} />
          <Route path="messages" element={<Explorer />} />
          <Route path="messages/:id" element={<Message />} />
          <Route path="errors" element={<Errors key="errors" />} />
          <Route path="dlq" element={<Errors dead key="dlq" />} />
          <Route path="customers" element={<Customers />} />
          <Route path="reconcile" element={<Reconcile />} />
          <Route path="lab" element={<LabPage />} />
          <Route path="docs" element={<Docs />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>,
);
