import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { pageQueryClient } from "./queries.ts";

export function PageQueryRoot({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={pageQueryClient}>
			{children}
		</QueryClientProvider>
	);
}
