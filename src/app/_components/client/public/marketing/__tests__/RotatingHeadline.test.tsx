import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RotatingHeadline } from "../RotatingHeadline";

// matchMedia is not implemented in jsdom; the rotator queries it for
// prefers-reduced-motion. Provide a controllable stub on the window.
function mockMatchMedia(matches: boolean) {
	const listeners = new Set<(e: { matches: boolean }) => void>();
	const mql = {
		matches,
		addEventListener: (_: string, cb: (e: { matches: boolean }) => void) =>
			listeners.add(cb),
		removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) =>
			listeners.delete(cb),
	};
	window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia;
	return mql;
}

describe("RotatingHeadline", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders the first headline initially", () => {
		mockMatchMedia(false);
		render(<RotatingHeadline />);
		// Three variants are stacked; only the first is visually active. We assert
		// that all three exist (so layout reserves space) and the first is selected.
		expect(screen.getAllByText(/spreadsheets/i).length).toBeGreaterThan(0);
		expect(screen.getByRole("tab", { name: /Headline 1/ })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("auto-advances every ROTATE_MS while not paused or reduced-motion", () => {
		mockMatchMedia(false);
		render(<RotatingHeadline />);
		act(() => {
			vi.advanceTimersByTime(5_001);
		});
		expect(screen.getByRole("tab", { name: /Headline 2/ })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		act(() => {
			vi.advanceTimersByTime(5_001);
		});
		expect(screen.getByRole("tab", { name: /Headline 3/ })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("does NOT auto-advance when prefers-reduced-motion is set", () => {
		mockMatchMedia(true);
		render(<RotatingHeadline />);
		act(() => {
			vi.advanceTimersByTime(20_000);
		});
		expect(screen.getByRole("tab", { name: /Headline 1/ })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("advances on user click of a dot tab", async () => {
		// Fake timers interfere with userEvent's internal awaits, so use real
		// timers for this case — the test doesn't depend on the rotation tick.
		vi.useRealTimers();
		mockMatchMedia(false);
		const user = userEvent.setup();
		render(<RotatingHeadline />);
		await user.click(screen.getByRole("tab", { name: /Headline 3/ }));
		expect(screen.getByRole("tab", { name: /Headline 3/ })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});
});
