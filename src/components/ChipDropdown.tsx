import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface Props {
  id: string;
  label: ReactNode;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  align?: "left" | "right";
  /** The chip is narrowing the view (a non-default filter). Paints a
   *  persistent accent so a short/empty list's cause is one glance away. */
  active?: boolean;
}

export function ChipDropdown({
  id,
  label,
  open,
  onToggle,
  onClose,
  children,
  disabled,
  title,
  align = "left",
  active,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      // A context menu spawned from a row in this dropdown renders as a
      // fixed overlay OUTSIDE the chip subtree (so the dropdown's edge-nudge
      // transform can't skew it) — clicking it is not an outside click.
      if ((e.target as HTMLElement | null)?.closest?.(".context-menu")) return;
      onClose();
    }
    function key(e: KeyboardEvent) {
      // The Esc that cancels an IME composition (in the chip's search input)
      // must not close the dropdown.
      if (e.isComposing) return;
      if (e.key === "Escape") {
        // The update modal is the topmost layer — it must win Esc even if a
        // dropdown was left open beneath it.
        if (document.querySelector(".update-modal")) return;
        // Same for an open context menu: it closes itself on Esc, and one
        // Esc = one layer — the dropdown waits for the next one.
        if (document.querySelector(".context-menu")) return;
        onClose();
        // One Esc = one layer: without this, the same keypress fell through
        // to App's cascade and ALSO collapsed the open commit expansion —
        // the only overlay that leaked (ContextMenu/SearchBar/find all stop).
        e.preventDefault();
        e.stopPropagation();
      }
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);

  // `align` only picks which edge to anchor to; on the fixed-width panel a
  // dropdown can still spill past the opposite window edge. Once open,
  // measure it and nudge it back inside with a transform.
  useLayoutEffect(() => {
    if (!open) return;
    const el = dropdownRef.current;
    if (!el) return;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    const baseLeft = rect.left - shift;
    const baseRight = rect.right - shift;
    let dx = 0;
    if (baseLeft < pad) dx = pad - baseLeft;
    else if (baseRight > window.innerWidth - pad)
      dx = window.innerWidth - pad - baseRight;
    if (dx !== shift) setShift(dx);
  }, [open, align, shift]);

  // When the label itself is a string, surface it as the button title so
  // the truncated/ellipsised text still has a hover-reveal — caller can
  // still override with an explicit `title` prop.
  const effectiveTitle =
    title ?? (typeof label === "string" ? label : undefined);

  return (
    <div className="chip-wrap" data-chip={id} ref={ref}>
      <button
        type="button"
        className={
          "chip" +
          (open ? " open" : "") +
          (active ? " active" : "") +
          (disabled ? " disabled" : "")
        }
        onClick={() => {
          if (!disabled) onToggle();
        }}
        disabled={disabled}
        title={effectiveTitle}
      >
        <span className="chip-label">{label}</span>
        <span className="chip-caret">▾</span>
      </button>
      {open && (
        <div
          ref={dropdownRef}
          className={"chip-dropdown chip-dropdown-" + align}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
        >
          {children}
        </div>
      )}
    </div>
  );
}
