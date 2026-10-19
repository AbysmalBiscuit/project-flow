import * as stylex from "@stylexjs/stylex";
import { colours, darkValues, lightValues, scheme } from "./tokens.stylex.ts";

export const lightTheme = stylex.createTheme(colours, lightValues);

export const darkTheme = stylex.createTheme(colours, darkValues);

export const lightScheme = stylex.createTheme(scheme, { page: "light" });

export const darkScheme = stylex.createTheme(scheme, { page: "dark" });
