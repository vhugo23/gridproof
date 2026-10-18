
import ApiStatus from "@/components/api-status";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <div className="w-full max-w-lg space-y-6">
        <div>
          <p className="mb-2 text-sm font-medium tracking-widest text-red-500">
            GRIDPROOF
          </p>

          <h1 className="text-3xl font-semibold text-white">
            Power Integration Workbench
          </h1>

          <p className="mt-3 text-zinc-400">
            Virtual commissioning and failure simulation for
            integrated power systems.
          </p>
        </div>

        <ApiStatus />
      </div>
    </main>
  );
}
