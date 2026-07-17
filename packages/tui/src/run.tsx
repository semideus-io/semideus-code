import { render } from "ink";
import { App, type AppProps } from "./app";

/** Mount the TUI and resolve when it unmounts (/exit or ctrl+c). */
export async function runTui(props: AppProps): Promise<void> {
  const instance = render(<App {...props} />);
  await instance.waitUntilExit();
}
