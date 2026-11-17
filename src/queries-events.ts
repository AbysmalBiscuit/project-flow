import type { Overview } from "./domain.ts";
import { onAppEvent, onEventStreamOpen } from "./events.ts";
import { pageQueryClient } from "./queries-client.ts";
import { pageQuery } from "./queries-page.ts";
import { saveSettingsKey } from "./queries-settings.ts";

let eventsWired = false;

function applyViewsEvent(body: Overview): void {
	const updatedAt =
		pageQueryClient.getQueryState(pageQuery.overview.queryKey)?.dataUpdatedAt ??
		0;
	pageQueryClient.setQueryData(pageQuery.overview.queryKey, body, {
		updatedAt,
	});
	// A pending save writes the saved settings when it lands.
	if (pageQueryClient.isMutating({ mutationKey: saveSettingsKey }) === 0) {
		void pageQueryClient.invalidateQueries(pageQuery.settings);
	}
}

function applyOverviewEvent(body: Overview): void {
	applyViewsEvent(body);
	void pageQueryClient.invalidateQueries(pageQuery.needsYou);
	void pageQueryClient.invalidateQueries(pageQuery.inbox);
	void pageQueryClient.invalidateQueries({ queryKey: ["project"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["thread"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["run"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["checkpoint"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["agents"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["artifacts"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["artifact"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["sandbox"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["files"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["source"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["transcript"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["runSettings"] });
	void pageQueryClient.invalidateQueries(pageQuery.runs);
	void pageQueryClient.invalidateQueries({ queryKey: ["factories"] });
	void pageQueryClient.invalidateQueries(pageQuery.workflows);
	void pageQueryClient.invalidateQueries({ queryKey: ["workflow"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["verification"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["retros"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["memories"] });
}

function invalidatePageQueries(): void {
	void pageQueryClient.invalidateQueries(pageQuery.overview);
	void pageQueryClient.invalidateQueries(pageQuery.needsYou);
	void pageQueryClient.invalidateQueries(pageQuery.inbox);
	void pageQueryClient.invalidateQueries(pageQuery.settings);
	void pageQueryClient.invalidateQueries({ queryKey: ["project"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["thread"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["run"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["checkpoint"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["agents"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["artifacts"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["artifact"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["sandbox"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["files"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["source"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["transcript"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["runSettings"] });
	void pageQueryClient.invalidateQueries(pageQuery.runs);
	void pageQueryClient.invalidateQueries({ queryKey: ["factories"] });
	void pageQueryClient.invalidateQueries(pageQuery.workflows);
	void pageQueryClient.invalidateQueries({ queryKey: ["workflow"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["verification"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["retros"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["memories"] });
}

export function wirePageQueryEvents(): void {
	if (eventsWired || typeof window === "undefined") {
		return;
	}
	eventsWired = true;
	onEventStreamOpen(invalidatePageQueries);
	onAppEvent("overview", (event) => {
		applyOverviewEvent(JSON.parse(event.data) as Overview);
	});
	onAppEvent("views", (event) => {
		applyViewsEvent(JSON.parse(event.data) as Overview);
	});
	onAppEvent("notification", () => {
		void pageQueryClient.invalidateQueries(pageQuery.inbox);
	});
}
