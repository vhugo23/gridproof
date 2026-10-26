import { useId } from "react";

// Shared by the synthetic workbenches. Moved unchanged from the Daventry workbench.
function Field({
  label,
  unit,
  hint,
  value,
  error,
  onChange,
}: {
  label: string;
  unit: string;
  hint: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-gp-text">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-hint${error ? ` ${id}-err` : ""}`}
          onChange={(event) => onChange(event.target.value)}
          className={`w-28 rounded-md border bg-gp-bg px-2.5 py-1.5 text-right font-mono text-sm text-gp-text ${
            error ? "border-gp-error" : "border-gp-line-strong"
          }`}
        />
        <span className="text-xs text-gp-faint">{unit}</span>
      </div>
      <p id={`${id}-hint`} className="mt-1 text-[11px] text-gp-faint">
        {hint}
      </p>
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-gp-error">
          {error}
        </p>
      )}
    </div>
  );
}

export default Field;
