import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";
import { useEffect, useRef, useState } from "react";
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
  useLocation,
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
  FlaskConical,
  GitBranch,
  Menu,
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
  type EventRow,
  type Issue,
  type Route as RouteModel,
  type Stats,
  type System,
  type Viewer,
} from "./api";
import { Badge, Empty, ErrorBox, Events, Heading, Panel } from "./ui";
import { Customers, Lab, Reconcile } from "./workflows";
import { Explorer } from "./explorer";
import { Message } from "./trace";
import { messageLink, outcomes, protocol } from "./presentation";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const polling = { refetchInterval: 4000 };
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
const groups = [
  [
    "Работа с событиями",
    navigation.filter(([, label]) =>
      ["Сводка", "Сообщения", "Ошибки", "Очередь DLQ"].includes(label),
    ),
  ],
  [
    "Интеграции",
    navigation.filter(([, label]) =>
      ["Системы", "Маршруты", "Маппинг", "Контракты"].includes(label),
    ),
  ],
  [
    "Данные",
    navigation.filter(([, label]) => ["Клиенты CRM", "Сверка"].includes(label)),
  ],
] as const;

function Shell() {
  const [user, setUser] = useState<Viewer | null>(null);
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const menuButton = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const qc = useQueryClient();
  useEffect(() => {
    if (user) main.current?.focus({ preventScroll: true });
  }, [location.pathname, user]);
  if (!user) return <Login onLogin={setUser} />;
  return (
    <div className="shell">
      <a href="#main-content" className="skip-link">
        К содержимому
      </a>
      <header className="app-bar">
        <div className="app-bar-inner">
          <Link
            to="/"
            aria-label="Nexora · Сводка"
            onClick={() => setMenu(false)}
          >
            <Brand />
          </Link>
          <span className="environment">
            {user.lab ? "Изолированный стенд" : "Учебный стенд"}
          </span>
          <div className="account">
            <span className="role">{user.role}</span>
            <button
              className="menu-toggle"
              ref={menuButton}
              aria-controls="console-navigation"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Menu size={16} aria-hidden="true" /> Разделы
            </button>
            <button
              className="icon"
              aria-label="Выйти"
              onClick={() => {
                session("");
                qc.clear();
                setMenu(false);
                setUser(null);
              }}
            >
              <LogOut size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <nav
        id="console-navigation"
        className={"console-navigation" + (menu ? " menu-open" : "")}
        aria-label="Разделы консоли"
        onKeyDown={(e) => {
          if (e.key === "Escape" && menu) {
            setMenu(false);
            menuButton.current?.focus();
          }
        }}
      >
        <div className="console-navigation-inner">
          {groups.map(([label, items]) => (
            <div className="nav-section" key={label}>
              <p>{label}</p>
              <ul>
                {items.map(([path, name, Icon]) => (
                  <li key={path}>
                    <NavLink
                      to={path}
                      end={path === "/"}
                      onClick={() => {
                        setMenu(false);
                        if (menu)
                          requestAnimationFrame(() => main.current?.focus());
                      }}
                    >
                      <Icon size={15} aria-hidden="true" />
                      {name}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {user.lab && (
            <div className="nav-section">
              <p>Изолированный стенд</p>
              <ul>
                <li>
                  <NavLink
                    to="/lab"
                    onClick={() => {
                      setMenu(false);
                      if (menu)
                        requestAnimationFrame(() => main.current?.focus());
                    }}
                  >
                    <FlaskConical size={15} aria-hidden="true" />
                    Лаборатория
                  </NavLink>
                </li>
              </ul>
            </div>
          )}
        </div>
      </nav>
      <div className="workspace">
        <main id="main-content" tabIndex={-1} ref={main}>
          <Outlet context={user} />
        </main>
      </div>
    </div>
  );
}

function useIssues(dead = false, offset = 0) {
  return useQuery({
    queryKey: ["issues", dead, offset],
    queryFn: () => api<Issue[]>(`/errors?dead_only=${dead}&offset=${offset}`),
    refetchInterval: 4000,
  });
}

function IssueRows({ items, from }: { items: Issue[]; from?: string }) {
  return (
    <ul className="issue-list">
      {items.map((i) => (
        <li key={i.event_id + (i.delivery_id ?? "")}>
          <div>
            <Link
              to={messageLink(i.event_id, i.delivery_id, undefined, from)}
              aria-label={
                (i.target ?? "Входной карантин") + " · " + short(i.event_id)
              }
            >
              {i.target ?? "Входной карантин"} ·{" "}
              <code>{short(i.event_id)}</code>
            </Link>
            <p>
              {outcomes[i.code] ?? i.code} · <code>{i.code}</code>
            </p>
          </div>
          <Badge status={i.status} />
          <span className="muted">Событие принято {stamp(i.received_at)}</span>
        </li>
      ))}
    </ul>
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
    queryFn: () => api<EventRow[]>("/messages?include_deliveries=true"),
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
    refetchInterval: 7000,
  });
  const issues = useIssues();
  const pending = stats.data?.states
    .filter((x) => x.status === "PENDING")
    .reduce((n, x) => n + x.count, 0);
  const counts = stats.data?.states.filter(
    (x) => x.status === "RETRY" || x.status === "DEAD",
  );
  return (
    <>
      <Heading
        title="Сводка обмена"
        subtitle="Исключения интеграций и доступность получателей"
      >
        <Link className="primary" to="/messages">
          Найти событие <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </Heading>
      <ErrorBox
        error={
          stats.error ??
          messages.error ??
          broker.error ??
          systems.error ??
          issues.error
        }
      />
      <div className="operations-grid">
        <div>
          <Panel
            title="Требуют внимания"
            action={<Link to="/errors">Мониторинг ошибок</Link>}
          >
            {issues.data?.length ? (
              <IssueRows items={issues.data.slice(0, 6)} from="/errors" />
            ) : (
              <Empty pending={issues.isPending}>
                {issues.error
                  ? "Список временно недоступен."
                  : "Активных ошибок и отклонений нет."}
              </Empty>
            )}
          </Panel>
          <Panel
            title="Последние события"
            action={<Link to="/messages">Открыть журнал</Link>}
          >
            <Events
              data={messages.data?.slice(0, 7)}
              pending={messages.isPending}
            />
          </Panel>
        </div>
        <div>
          <Panel title="Операционная очередь">
            <ul className="queue-links">
              <li>
                <Link to="/messages?status=PENDING">В очереди у Nexora</Link>
                <strong>{pending ?? "—"}</strong>
              </li>
              <li>
                <Link to="/messages?status=RETRY">Ожидают повтора</Link>
                <strong>
                  {counts
                    ? counts
                        .filter((x) => x.status === "RETRY")
                        .reduce((n, x) => n + x.count, 0)
                    : "—"}
                </strong>
              </li>
              <li>
                <Link to="/dlq">Терминальные доставки</Link>
                <strong>
                  {counts
                    ? counts
                        .filter((x) => x.status === "DEAD")
                        .reduce((n, x) => n + x.count, 0)
                    : "—"}
                </strong>
              </li>
              <li>
                <Link to="/dlq">Входной карантин</Link>
                <strong>{stats.data?.rejected ?? "—"}</strong>
              </li>
            </ul>
          </Panel>
          <Panel title="Транспорт RabbitMQ">
            {broker.isPending ? (
              <Empty pending />
            ) : !broker.data?.available ? (
              <Empty>Данные брокера недоступны.</Empty>
            ) : (
              <dl className="meta">
                <div>
                  <dt>Готово</dt>
                  <dd>{broker.data.ready ?? "—"}</dd>
                </div>
                <div>
                  <dt>Без подтверждения</dt>
                  <dd>{broker.data.unacked ?? "—"}</dd>
                </div>
              </dl>
            )}
          </Panel>
          <Panel
            title="Участники обмена"
            action={<Link to="/systems">Контракты и health</Link>}
          >
            <div className="system-list">
              {systems.data?.map((s) => (
                <div key={s.name}>
                  <span>
                    <strong>{s.name}</strong>
                    <small>{s.protocol}</small>
                  </span>
                  <Badge status={s.reachable ? "UP" : "DOWN"} />
                </div>
              )) ?? <Empty pending={systems.isPending} />}
            </div>
          </Panel>
        </div>
      </div>
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
  const operations: Record<string, { method: string; contract: string }> = {
    ERP: { method: "POST /soap · UpsertPartner", contract: "partner.wsdl" },
    Billing: {
      method: "PUT /v1/customers/{id}",
      contract: "billing.openapi.json",
    },
    CRM: {
      method: "PUT /v1/customers/{id}/payment-projection",
      contract: "crm.openapi.json",
    },
  };
  const fields = [
    [
      "CRM → ERP",
      "customer_id, version, data.name",
      "GlobalId, Version, LegalName",
    ],
    [
      "CRM → Billing",
      "customer_id, data.name, data.email, version",
      "{id} в URL, name, email, version",
    ],
    [
      "Billing → CRM",
      "customer_id, data.status, version",
      "{id} в URL, status, version",
    ],
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
      {!mapping && (
        <Panel
          title="Архитектура обмена"
          action={<a href="/contracts/asyncapi.yaml">AMQP · AsyncAPI</a>}
        >
          <div className="architecture">
            <ol className="architecture-lanes" aria-label="Путь по архитектуре">
              {data.data?.map((route) => (
                <li key={route.event}>
                  <div className="architecture-origin">
                    <strong>{route.source}</strong>
                    <small>
                      {route.event} · схема v{route.version}
                    </small>
                  </div>
                  <span className="architecture-edge">Outbox · AMQP</span>
                  <div className="architecture-node">
                    <strong>RabbitMQ</strong>
                    <small>nexora.events</small>
                  </div>
                  <span className="architecture-edge">AMQP</span>
                  <div className="architecture-node">
                    <strong>Nexora Worker</strong>
                    <small>Inbox · PostgreSQL</small>
                  </div>
                  <span className="architecture-edge">HTTP</span>
                  <ul className="architecture-targets">
                    {route.targets.map((target) => (
                      <li key={target}>
                        <strong>
                          {target} · {protocol[target]}
                        </strong>
                        <small>{operations[target]?.method}</small>
                        {operations[target] && (
                          <a href={"/contracts/" + operations[target].contract}>
                            Открыть контракт
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            {data.isPending && <Empty pending />}
            <p className="muted">
              AMQP доставляет событие до Nexora. Worker подтверждает его после
              записи Inbox и вызывает получателей отдельно. Таблица ниже
              содержит текстовый перечень маршрутов.
            </p>
          </div>
        </Panel>
      )}
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
                      <td>
                        {r.targets.join(" · ")}{" "}
                        <Link
                          to={"/messages?kind=" + encodeURIComponent(r.event)}
                        >
                          События маршрута
                        </Link>
                      </td>
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
function Errors({ dead = false }: { dead?: boolean }) {
  const [offset, setOffset] = useState(0);
  const data = useIssues(dead, offset);
  return (
    <>
      <Heading
        title={dead ? "Очередь DLQ" : "Мониторинг ошибок"}
        subtitle={
          dead
            ? "Входной карантин и терминальные доставки · PostgreSQL"
            : "Входные отклонения, активные повторы и терминальные доставки"
        }
      />
      <ErrorBox error={data.error} />
      <Panel
        title={dead ? "Карантин и исчерпанные доставки" : "Ошибки обработки"}
        action={
          <Link to={dead ? "/errors" : "/dlq"}>
            {dead ? "Все ошибки" : "Только DLQ"}
          </Link>
        }
      >
        {data.data?.length ? (
          <IssueRows items={data.data} from={dead ? "/dlq" : "/errors"} />
        ) : (
          <Empty pending={data.isPending}>
            {data.error
              ? "Список временно недоступен."
              : "Ошибок на этой странице нет."}
          </Empty>
        )}
        <div className="pager">
          <button disabled={!offset} onClick={() => setOffset(offset - 50)}>
            Назад
          </button>
          <span>Страница {offset / 50 + 1}</span>
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
