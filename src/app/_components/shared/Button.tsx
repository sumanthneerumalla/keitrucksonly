import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "~/lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium text-sm ring-offset-background transition-[transform,background-color,box-shadow,color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"bg-[var(--brand)] text-white shadow-brand-pill hover:bg-[var(--brand-ink)]",
				outline:
					"border border-[var(--line-2)] bg-transparent text-[var(--ink)] hover:bg-[rgba(20,19,14,0.04)]",
				ghost: "text-[var(--ink)] hover:bg-[rgba(20,19,14,0.04)]",
				destructive:
					"border border-red-600 bg-red-600 text-white hover:bg-red-700",
				"destructive-outline":
					"border border-red-200 text-red-600 hover:bg-red-50",
			},
			size: {
				default: "h-10 px-4 py-2 text-sm",
				sm: "h-9 px-3 text-sm",
				lg: "h-12 px-8 text-base",
				icon: "h-10 w-10 p-0",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button";
		return (
			<Comp
				className={cn(buttonVariants({ variant, size, className }))}
				ref={ref}
				{...props}
			/>
		);
	},
);

Button.displayName = "Button";

export { Button, buttonVariants };
