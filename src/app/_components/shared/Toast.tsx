"use client";

import { AlertCircle, CheckCircle, Info, X } from "lucide-react";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useRef,
	useState,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
	id: string;
	message: string;
	variant: ToastVariant;
}

interface ToastContextValue {
	toast: (message: string, variant?: ToastVariant) => void;
	dismiss: (id: string) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────
//
// Two contexts so that consumers calling `useToast()` to get a stable
// `{ toast, dismiss }` pair don't re-render on every toast push/dismiss.
// The toasts list is read only by the internal <ToastContainer/>.
//
// No-op default fallback for components rendered outside a ToastProvider
// (e.g. unit tests, public pages without authed layout). Calls become
// silent no-ops rather than crashing — error messages just won't surface.

const noopToast: ToastContextValue = {
	toast: () => {},
	dismiss: () => {},
};

const ToastContext = createContext<ToastContextValue>(noopToast);
const ToastListContext = createContext<{ toasts: Toast[] }>({ toasts: [] });

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * Mount once at the app shell. Owns the toast list and exposes
 * `{ toast, dismiss }` via context to any descendant via `useToast()`.
 * Renders <ToastContainer/> automatically — call sites should NOT render
 * their own ToastContainer.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const counterRef = useRef(0);

	const dismiss = useCallback((id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
	}, []);

	const toast = useCallback(
		(message: string, variant: ToastVariant = "info") => {
			counterRef.current += 1;
			const id = `toast-${counterRef.current}`;
			setToasts((prev) => [...prev, { id, message, variant }]);
			setTimeout(() => dismiss(id), 5000);
		},
		[dismiss],
	);

	return (
		<ToastContext.Provider value={{ toast, dismiss }}>
			<ToastListContext.Provider value={{ toasts }}>
				{children}
				<ToastContainer />
			</ToastListContext.Provider>
		</ToastContext.Provider>
	);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns `{ toast, dismiss }` — call `toast(message, variant)` to push a
 * toast onto the global stack. Variants: "success" | "error" | "info".
 *
 * Auto-dismisses after 5s. The container is rendered globally by
 * <ToastProvider/>; do NOT render <ToastContainer/> at call sites.
 */
export function useToast() {
	return useContext(ToastContext);
}

// ─── Internals ────────────────────────────────────────────────────────────────

const ICONS: Record<ToastVariant, React.ReactNode> = {
	success: <CheckCircle size={16} className="shrink-0 text-green-600" />,
	error: (
		<AlertCircle size={16} className="shrink-0 text-[var(--destructive)]" />
	),
	info: <Info size={16} className="shrink-0 text-[var(--primary)]" />,
};

const BORDER_COLORS: Record<ToastVariant, string> = {
	success: "border-green-200",
	error: "border-red-200",
	info: "border-[var(--border)]",
};

function ToastItem({
	toast,
	onDismiss,
}: {
	toast: Toast;
	onDismiss: (id: string) => void;
}) {
	return (
		<div
			className={`glass-panel flex w-full max-w-sm animate-slide-in-right items-start gap-3 rounded-lg border p-3 ${BORDER_COLORS[toast.variant]}`}
			role="alert"
		>
			{ICONS[toast.variant]}
			<p className="flex-1 text-[var(--foreground)] text-sm">{toast.message}</p>
			<button
				type="button"
				onClick={() => onDismiss(toast.id)}
				className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
				aria-label="Dismiss"
			>
				<X size={14} />
			</button>
		</div>
	);
}

function ToastContainer() {
	const { toasts } = useContext(ToastListContext);
	const { dismiss } = useContext(ToastContext);

	if (toasts.length === 0) return null;

	return (
		<div
			className="fixed right-4 bottom-4 z-[100] flex flex-col gap-2 sm:right-6 sm:bottom-6"
			aria-live="polite"
		>
			{toasts.map((t) => (
				<ToastItem key={t.id} toast={t} onDismiss={dismiss} />
			))}
		</div>
	);
}
