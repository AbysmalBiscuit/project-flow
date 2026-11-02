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

/**
 * The pin list with the project pinned or unpinned. `names` holds each form
 * of the project that a saved pin can take, and `pin` is the form to add.
 */
export function withPin(
	pins: ProjectPin[],
	{ names, pin, on }: { names: ProjectPin[]; pin: ProjectPin; on: boolean },
): ProjectPin[] {
	const others = pins.filter(
		(item) => !names.some((name) => samePin(name, item)),
	);
	return on ? [...others, pin] : others;
}
