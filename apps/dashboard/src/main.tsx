import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./components/Shell";
import { ApiError, endpoints } from "./lib/api";
import { startRealtime } from "./lib/realtime";
import { usePath } from "./lib/router";
import { Insights } from "./pages/Insights";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { MessagePage } from "./pages/Message";
import { Sent } from "./pages/Sent";
import { SettingsPage } from "./pages/Settings";
import "./styles.css";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

function App() {
  const path = usePath();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: endpoints.me });
  const signedIn = me.isSuccess;

  useEffect(() => (signedIn ? startRealtime(qc) : undefined), [signedIn, qc]);

  // Shareable marketing page, also handy for previewing it while signed in.
  if (path === "/welcome") return <Landing />;

  if (me.isPending) return <div className="min-h-dvh" />;
  if (me.error instanceof ApiError && me.error.status === 401) {
    return path === "/" ? <Landing /> : <Login />;
  }
  if (me.isError) {
    return (
      <div className="grid min-h-dvh place-items-center px-4 text-sm text-muted">
        Couldn't reach the server. {me.error.message}
      </div>
    );
  }

  const messageMatch = path.match(/^\/m\/([^/]+)$/);
  let page = <Sent />;
  if (messageMatch) page = <MessagePage id={decodeURIComponent(messageMatch[1]!)} />;
  else if (path === "/insights") page = <Insights />;
  else if (path === "/settings") page = <SettingsPage me={me.data} />;

  return (
    <Shell me={me.data} path={path}>
      {page}
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
