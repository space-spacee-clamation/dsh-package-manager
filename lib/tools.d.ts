import { Context } from "@deepseek-ai/cordis";
//#region src/tools.d.ts
declare const name = "package-manager-tools";
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { apply, inject, name };