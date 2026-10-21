"use client";

/** iOS-style switch. Pass a label for screen readers. */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="peer sr-only"
        aria-label={label}
      />
      <span className="h-[26px] w-[44px] rounded-full bg-muted transition-colors duration-200 ease-apple peer-checked:bg-secondary peer-disabled:opacity-50 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring" />
      <span className="pointer-events-none absolute left-[3px] top-[3px] size-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform duration-200 ease-apple peer-checked:translate-x-[18px]" />
    </span>
  );
}
