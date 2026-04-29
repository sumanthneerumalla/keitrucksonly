import type { ReactNode } from "react";

interface SectionHeadProps {
	num: string;
	title: ReactNode;
	lead?: ReactNode;
}

export function SectionHead({ num, title, lead }: SectionHeadProps) {
	return (
		<div className="mb-12 grid items-end gap-5 md:grid-cols-[auto_1fr]">
			<span className="sec-num">{num}</span>
			<div>
				<h2>{title}</h2>
				{lead ? <p className="lead mt-3 max-w-[700px]">{lead}</p> : null}
			</div>
		</div>
	);
}

export default SectionHead;
