export type Fetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;
