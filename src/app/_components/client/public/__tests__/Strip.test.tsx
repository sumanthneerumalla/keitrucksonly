import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Strip } from "../Strip";

const STORAGE_KEY = "fp-strip-dismissed-v1";

describe("Strip", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	afterEach(() => {
		window.localStorage.clear();
	});

	it("renders the announcement by default", () => {
		render(<Strip />);
		expect(screen.getByText(/Replacing 4–6 tools/i)).toBeInTheDocument();
	});

	it("hides on dismiss and writes to localStorage", async () => {
		const user = userEvent.setup();
		render(<Strip />);
		await user.click(
			screen.getByRole("button", { name: /Dismiss announcement/ }),
		);
		expect(screen.queryByText(/Replacing 4–6 tools/i)).not.toBeInTheDocument();
		expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
	});

	it("hides on mount when localStorage flag is already set", async () => {
		window.localStorage.setItem(STORAGE_KEY, "1");
		render(<Strip />);
		// Effect runs on mount; wait a tick.
		await vi.waitFor(() => {
			expect(
				screen.queryByText(/Replacing 4–6 tools/i),
			).not.toBeInTheDocument();
		});
	});

	it("renders the See plans link by default (pathname is /)", () => {
		render(<Strip />);
		expect(screen.getByRole("link", { name: /See plans/ })).toHaveAttribute(
			"href",
			"/pricing",
		);
	});
});
