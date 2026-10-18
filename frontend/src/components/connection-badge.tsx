type ConnectionBadgeProps = {
  connected: boolean;
};

export function ConnectionBadge({ connected }: ConnectionBadgeProps) {
  return (
    <span role="status" aria-live="polite">
      {connected ? "API connected" : "API unavailable"}
    </span>
  );
}
