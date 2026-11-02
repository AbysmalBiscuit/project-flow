import type { ProjectPin } from "./configuration.ts";
import { samePin } from "./project-ref.ts";

/** Marks each project that a pin names, and clears the mark of the rest. */
export function markPinned<T extends { ref: ProjectPin; pinned?: true }>(
	projects: T[],
	pins: ProjectPin[],
): (Omit<T, "pinned"> & { pinned?: true })[] {
	return projects.map(({ pinned: _pinned, ...project }) =>
		pins.some((pin) => samePin(pin, project.ref))
			? { ...project, pinned: true as const }
			: project,
	);
}
