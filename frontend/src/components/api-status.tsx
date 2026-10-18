"use client";

import { useEffect, useState } from "react";

type ApiStatus = "checking" | "connected" | "unavailable";

export default function ApiStatus() {
  const [status, setStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();

    async function checkConnection() {
      try {
        const response = await fetch("/api/v1/health", {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        const data: unknown = await response.json();

        if (
          typeof data !== "object" ||
          data === null ||
          !("status" in data) ||
          data.status !== "ok"
        ) {
          throw new Error("Unexpected API response");
        }

        setStatus("connected");
      } catch {
        if (!controller.signal.aborted) {
          setStatus("unavailable");
        }
      }
    }

    void checkConnection();

    return () => controller.abort();
  }, []);

  const messages: Record<ApiStatus, string> = {
    checking: "Checking API connection...",
    connected: "GridProof API connected",
    unavailable: "GridProof API unavailable",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-zinc-700 bg-zinc-900 p-4"
    >
      <div className="flex items-center gap-3">
        <span
          className={`h-3 w-3 rounded-full ${
            status === "connected"
              ? "bg-green-500"
              : status === "unavailable"
                ? "bg-red-500"
                : "bg-yellow-500"
          }`}
        />
        <p className="text-sm text-white">{messages[status]}</p>
      </div>
    </div>
  );
}
