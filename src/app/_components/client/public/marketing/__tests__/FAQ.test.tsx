import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FAQ } from "../FAQ";

const ITEMS: Array<[string, string]> = [
	["First question?", "First answer body."],
	["Second question?", "Second answer body."],
	["Third question?", "Third answer body."],
];

describe("FAQ", () => {
	it("opens the first item by default", () => {
		render(<FAQ items={ITEMS} />);
		expect(screen.getByText("First answer body.")).toBeInTheDocument();
		expect(screen.queryByText("Second answer body.")).not.toBeInTheDocument();
	});

	it("opens a different item on click and closes the previous", async () => {
		const user = userEvent.setup();
		render(<FAQ items={ITEMS} />);
		await user.click(screen.getByRole("button", { name: /Second question/ }));
		expect(screen.getByText("Second answer body.")).toBeInTheDocument();
		expect(screen.queryByText("First answer body.")).not.toBeInTheDocument();
	});

	it("closes the open item when clicked again (toggle)", async () => {
		const user = userEvent.setup();
		render(<FAQ items={ITEMS} />);
		await user.click(screen.getByRole("button", { name: /First question/ }));
		expect(screen.queryByText("First answer body.")).not.toBeInTheDocument();
	});

	it("renders custom title and num", () => {
		render(<FAQ items={ITEMS} num="99 / Test" title="Custom title" />);
		expect(screen.getByText("99 / Test")).toBeInTheDocument();
		expect(screen.getByText("Custom title")).toBeInTheDocument();
	});
});
