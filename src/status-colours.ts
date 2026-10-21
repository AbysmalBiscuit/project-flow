import { installStatusColours } from "./domain.ts";
import { tokenColour } from "./stylex-plugin.ts";

installStatusColours(() => ({
	backlog: tokenColour("backlog"),
	inProgress: tokenColour("inProgress"),
	inReview: tokenColour("inReview"),
	awaitingMerge: tokenColour("awaitingMerge"),
	done: tokenColour("done"),
	dropped: tokenColour("dropped"),
}));
