/** Types a part of the `Bun.serve` route table, so each handler gets the params of its path. */
export function routeTable<R extends string>(
	routes: Bun.Serve.Routes<undefined, R>,
): Bun.Serve.Routes<undefined, R> {
	return routes;
}
