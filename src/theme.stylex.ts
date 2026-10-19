import * as stylex from "@stylexjs/stylex";
import { colours, darkValues, lightValues } from "./tokens.stylex.ts";

export const lightTheme = stylex.createTheme(colours, lightValues);

export const darkTheme = stylex.createTheme(colours, darkValues);
